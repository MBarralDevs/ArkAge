import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";
import { resumeHook } from "workflow/api";
import { stepCountIs, type UIMessageChunk, type ModelMessage } from "ai";
import { keccak256, toHex } from "viem";
import { db } from "@/lib/db";
import { readJob } from "@/lib/erc8183-state";
import { persistEvidence, type EvidenceRecord } from "@/lib/evidence-store";
import {
    callComplete,
    callReject,
    writeReputationFeedback,
} from "./lib/settlement-steps";
import { evaluatorDoneToken, jobTerminalToken } from "./lib/hook-tokens";
import {
    EVALUATOR_PROMPT_VERSION,
    EVALUATOR_SYSTEM_PROMPT,
    buildEvaluationPrompt,
    modelForTier,
    type EvaluatorTier,
} from "./lib/evaluator-prompts";
import {
    recordWorkflowStart,
    recordWorkflowComplete,
} from "./lib/recording-steps";

/**
 * llmEvaluatorAgent — tier-selected Claude model evaluates a deliverable.
 *
 * Spawned by `jobLifecycle` Phase 3 when ArkAge is the registered evaluator
 * (Plan B Task 27 stubbed the spawn; this commit lands the agent itself).
 *
 * 1. loadJobContext + fetchDeliverable (steps; durable, retryable)
 * 2. DurableAgent streams reasoning to namespace "evaluator:reasoning"
 *    (Plan C will subscribe via SSE for live dashboard rendering)
 * 3. persistEvaluation writes Vercel Blob + jobEvaluation row, returning
 *    the keccak256 evidenceHash that threads through ERC-8183 reason
 *    and ERC-8004 feedbackHash (the cryptographic link required by spec)
 * 4. Settle on-chain via Tier 3 validator wallet (callComplete | callReject)
 * 5. Fire evaluator:done + JobTerminal hooks so jobLifecycle resumes Phase 4
 *
 * Model IDs flow through AI Gateway — `anthropic/claude-haiku-4.5`,
 * `claude-sonnet-4.6`, `claude-opus-4.7` per `evaluator-prompts.ts`.
 */

interface EvaluatorOutput {
    verdict: "accept" | "reject";
    score: number;
    reasoning: string;
    concerns: string[];
}

async function loadJobContext(
    jobId: bigint,
): Promise<{ description: string; budget: bigint; deliverableHash: string }> {
    "use step";
    console.log(`[evaluator] loadJobContext jobId=${jobId}`);
    const job = await readJob(jobId);
    // The deliverable hash is not in the on-chain Job struct — it is only
    // emitted in the JobSubmitted event. The normalizer persists that
    // event's params (incl. `deliverable`) into job_events.
    const dbJob = await db.job.findUnique({
        where: { jobId: jobId.toString() },
        include: {
            events: {
                where: { eventKind: "submitted" },
                orderBy: { blockNumber: "desc" },
                take: 1,
            },
        },
    });
    const submitted = dbJob?.events[0];
    const deliverableHash =
        (submitted?.payloadJsonb as { deliverable?: string } | null)
            ?.deliverable ?? `0x${"0".repeat(64)}`;
    const description =
        job.description || dbJob?.descriptionUri || "(no description)";
    return { description, budget: job.budget, deliverableHash };
}

async function fetchDeliverable(deliverableHash: string): Promise<string> {
    "use step";
    console.log(`[evaluator] fetchDeliverable hash=${deliverableHash}`);
    const base =
        process.env.ARKAGE_DELIVERABLE_GATEWAY ??
        "https://arkage.network/api/deliverables/";
    const url = `${base}${deliverableHash}`;
    const res = await fetch(url);
    if (!res.ok) {
        console.log(`[evaluator] fetchDeliverable failed status=${res.status}`);
        return `(deliverable unavailable: ${res.status})`;
    }
    return await res.text();
}

async function persistEvaluation(args: {
    jobId: bigint;
    tier: EvaluatorTier;
    model: string;
    output: EvaluatorOutput;
    deliverableHash: string;
    inputTokens: number;
    outputTokens: number;
}): Promise<{ evidenceUri: string; evidenceHash: `0x${string}` }> {
    "use step";
    console.log(
        `[evaluator] persistEvaluation jobId=${args.jobId} verdict=${args.output.verdict}`,
    );
    const promptHash = keccak256(toHex(EVALUATOR_SYSTEM_PROMPT));
    const record: EvidenceRecord = {
        model: args.model,
        verdict: args.output.verdict,
        reasoning: args.output.reasoning,
        deliverableHash: args.deliverableHash,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        promptVersion: EVALUATOR_PROMPT_VERSION,
        promptHash,
        structuredResponse: args.output,
    };
    const { uri, hash } = await persistEvidence(args.jobId, record);

    const job = await db.job.findUnique({
        where: { jobId: args.jobId.toString() },
    });
    if (!job) throw new Error(`job ${args.jobId} not found in db`);

    await db.jobEvaluation.create({
        data: {
            jobId: job.id,
            workflowRunId: "pending",
            model: args.model,
            tier: args.tier,
            inputTokens: args.inputTokens,
            outputTokens: args.outputTokens,
            promptVersion: EVALUATOR_PROMPT_VERSION,
            promptHash: Buffer.from(promptHash.replace(/^0x/, ""), "hex"),
            deliverableHash: Buffer.from(
                args.deliverableHash.replace(/^0x/, ""),
                "hex",
            ),
            reasoningText: args.output.reasoning,
            structuredResponseJsonb: args.output as object,
            verdict: args.output.verdict,
            score: args.output.score,
            evidenceUri: uri,
            evidenceHash: Buffer.from(hash.replace(/^0x/, ""), "hex"),
        },
    });

    return { evidenceUri: uri, evidenceHash: hash };
}

// resumeHook from `workflow/api` is a no-op stub when imported inside a
// workflow body (the `workflow` package-export condition). Wrap each call
// in a step so the real implementation runs from a step context.
async function fireEvaluatorDoneHook(
    jobId: bigint,
    payload: { verdict: "accept" | "reject"; evidenceHash: `0x${string}` },
): Promise<void> {
    "use step";
    console.log(
        `[evaluator] fireEvaluatorDoneHook jobId=${jobId} verdict=${payload.verdict}`,
    );
    // A hook is the fast-path nudge, not the only path. If jobLifecycle
    // already advanced past its await (self-rescue chain poll) or never
    // registered this token, resumeHook throws HookNotFound — benign, the
    // settlement has already landed on-chain. Never fail the step for it.
    await resumeHook(evaluatorDoneToken(jobId), payload).catch((e) => {
        console.log(
            `[evaluator] evaluatorDone hook had no listener jobId=${jobId} (${e instanceof Error ? e.message : String(e)})`,
        );
    });
}

async function fireJobTerminalHook(
    jobId: bigint,
    status: "Completed" | "Rejected",
): Promise<void> {
    "use step";
    console.log(`[evaluator] fireJobTerminalHook jobId=${jobId} status=${status}`);
    await resumeHook(jobTerminalToken(jobId), { status }).catch((e) => {
        console.log(
            `[evaluator] jobTerminal hook had no listener jobId=${jobId} (${e instanceof Error ? e.message : String(e)})`,
        );
    });
}

/**
 * Parse the evaluator model's reply into a structured verdict.
 *
 * Models routinely wrap JSON in ```json fences or surround it with prose,
 * so a bare `JSON.parse` fails on otherwise-valid output. Strip a fence
 * if present, narrow to the outermost `{...}`, then parse and shape-check.
 * Returns null when nothing usable is found — the caller defaults to a
 * conservative reject.
 */
function parseEvaluatorOutput(text: string): EvaluatorOutput | null {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) t = fence[1].trim();
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        const obj = JSON.parse(t.slice(start, end + 1)) as
            Partial<EvaluatorOutput>;
        if (
            (obj.verdict === "accept" || obj.verdict === "reject") &&
            typeof obj.score === "number"
        ) {
            return {
                verdict: obj.verdict,
                score: obj.score,
                reasoning:
                    typeof obj.reasoning === "string" ? obj.reasoning : "",
                concerns: Array.isArray(obj.concerns)
                    ? obj.concerns.map((c) => String(c))
                    : [],
            };
        }
        return null;
    } catch {
        return null;
    }
}

function extractAssistantText(messages: ModelMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m || m.role !== "assistant") continue;
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
            return m.content
                .map((p) =>
                    typeof p === "object" && p !== null && "text" in p
                        ? String((p as { text: unknown }).text)
                        : "",
                )
                .join("");
        }
    }
    return "";
}

export async function llmEvaluatorAgent(jobId: bigint, tier: EvaluatorTier) {
    "use workflow";

    await recordWorkflowStart("evaluator", jobId);

    const ctx = await loadJobContext(jobId);
    const deliverable = await fetchDeliverable(ctx.deliverableHash);

    const agent = new DurableAgent({
        model: modelForTier(tier),
        instructions: EVALUATOR_SYSTEM_PROMPT,
    });

    const result = await agent.stream({
        messages: [
            {
                role: "user",
                content: buildEvaluationPrompt({
                    jobId,
                    description: ctx.description,
                    deliverable: { hash: ctx.deliverableHash, content: deliverable },
                    budget: ctx.budget,
                }),
            },
        ],
        writable: getWritable<UIMessageChunk>({ namespace: "evaluator:reasoning" }),
        stopWhen: stepCountIs(6),
    });

    const text = extractAssistantText(result.messages);
    const parsed: EvaluatorOutput = parseEvaluatorOutput(text) ?? {
        verdict: "reject",
        score: -100,
        reasoning: "Evaluator failed to produce parseable JSON output",
        concerns: ["malformed_output"],
    };
    console.log(
        `[evaluator] parsed verdict=${parsed.verdict} score=${parsed.score} jobId=${jobId}`,
    );

    const { evidenceUri, evidenceHash } = await persistEvaluation({
        jobId,
        tier,
        model: modelForTier(tier),
        output: parsed,
        deliverableHash: ctx.deliverableHash,
        inputTokens: 0,
        outputTokens: 0,
    });

    if (parsed.verdict === "accept") {
        await callComplete(jobId, evidenceHash);
    } else {
        await callReject(jobId, evidenceHash);
    }

    // Option C: write on-chain reputation straight to ERC-8004 with the
    // same evidence hash that settled the job — the cryptographic thread
    // from evaluation to settlement to reputation. Skips gracefully when
    // the provider isn't anchored; never blocks the settled job.
    const feedback = await writeReputationFeedback({
        jobId,
        score: parsed.score,
        verdict: parsed.verdict,
        evidenceUri,
        evidenceHash,
    });
    console.log(
        `[evaluator] reputation feedback jobId=${jobId} outcome=${feedback.kind}` +
            (feedback.kind === "skipped" ? ` reason=${feedback.reason}` : ""),
    );

    await fireEvaluatorDoneHook(jobId, {
        verdict: parsed.verdict,
        evidenceHash,
    });
    await fireJobTerminalHook(
        jobId,
        parsed.verdict === "accept" ? "Completed" : "Rejected",
    );

    await recordWorkflowComplete(parsed.verdict);
    return { verdict: parsed.verdict, evidenceHash };
}
