import { readJob, isTerminalState, type JobStatusEnum } from "@/lib/erc8183-state";
import { awaitChainEventWithRescue } from "./lib/self-rescue";
import {
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
} from "./lib/hook-tokens";
import {
    recordWorkflowStart,
    recordWorkflowAdvance,
    recordWorkflowComplete,
} from "./lib/recording-steps";
import { tryClaimRefund } from "./lib/settlement-steps";
import { db } from "@/lib/db";

/**
 * jobLifecycle — the spine of every ERC-8183 job ArkAge orchestrates.
 *
 * Four phases, each a self-rescuing await:
 *   1. wait for Funded
 *   2. wait for Submitted
 *   3. spawn the LLM evaluator child (only when ArkAge is the registered
 *      evaluator — clients can post jobs with their own evaluator and
 *      we just observe)
 *   4. wait for terminal state (Completed | Rejected | Expired)
 *
 * On every expiry, attempt claimRefund (best-effort, never bubbles).
 * Every transition records into workflow_runs so the stuck-workflow
 * reconciler can spot anything that drops between phases.
 *
 * Spawned by `arkage:post_job` once the createJob tx lands (the post_job
 * tool currently TODOs the spawn until this workflow exists; this commit
 * makes it spawnable).
 */

// --- Internal step helpers (each "use step") ---

async function pollJobState(jobId: bigint): Promise<JobStatusEnum> {
    "use step";
    console.log(`[jobLifecycle] pollJobState jobId=${jobId}`);
    const j = await readJob(jobId);
    return j.status;
}

async function isArkAgeEvaluator(jobId: bigint): Promise<boolean> {
    "use step";
    console.log(`[jobLifecycle] isArkAgeEvaluator jobId=${jobId}`);
    const j = await readJob(jobId);
    const validator = process.env.ARKAGE_VALIDATOR_WALLET_ADDRESS?.toLowerCase();
    return validator !== undefined && j.evaluator.toLowerCase() === validator;
}

async function loadJobTier(
    jobId: bigint,
): Promise<"fast" | "standard" | "premium"> {
    "use step";
    console.log(`[jobLifecycle] loadJobTier jobId=${jobId}`);
    const job = await db.job.findUnique({ where: { jobId: jobId.toString() } });
    const tier = job?.evaluatorTier as "fast" | "standard" | "premium" | undefined;
    return tier ?? "standard";
}

// llmEvaluatorAgent spawn is intentionally NOT imported here. Phase 10
// (Task 28) lands the agent and adds the `start(...)` call. Until then,
// jobLifecycle skips the spawn — the chain still progresses via
// whoever's holding the evaluator role (in early testnet runs, that's
// us via cast send through the Tier 3 validator, manually).
async function startEvaluatorChild(
    jobId: bigint,
    tier: "fast" | "standard" | "premium",
): Promise<{ skipped: true; reason: string }> {
    "use step";
    console.log(
        `[jobLifecycle] startEvaluatorChild SKIPPED jobId=${jobId} tier=${tier} (Phase 10 not yet wired)`,
    );
    return { skipped: true, reason: "llmEvaluatorAgent not yet implemented" };
}

// --- Workflow body ---

export async function jobLifecycle(jobId: bigint, expiredAtSec: number) {
    "use workflow";

    await recordWorkflowStart("job_lifecycle", jobId);

    // Phase 1: wait for Funded
    const funded = await awaitChainEventWithRescue<{ jobId: string }>({
        hookToken: jobFundedToken(jobId),
        pollChainState: () => pollJobState(jobId),
        isAdvancedPredicate: (s) =>
            s === "Funded" || s === "Submitted" || isTerminalState(s),
        expiredAtSec,
    });

    if (funded.kind === "expired") {
        await recordWorkflowComplete("expired_unfunded");
        return { outcome: "expired_unfunded" };
    }
    await recordWorkflowAdvance("funded");

    // Phase 2: wait for Submitted
    const submitted = await awaitChainEventWithRescue<{
        jobId: string;
        deliverable: string;
    }>({
        hookToken: jobSubmittedToken(jobId),
        pollChainState: () => pollJobState(jobId),
        isAdvancedPredicate: (s) => s === "Submitted" || isTerminalState(s),
        expiredAtSec,
    });

    if (submitted.kind === "expired") {
        await tryClaimRefund(jobId);
        await recordWorkflowComplete("expired_unsubmitted_refunded");
        return { outcome: "expired_unsubmitted_refunded" };
    }
    await recordWorkflowAdvance("submitted");

    // Phase 3: spawn evaluator child if ArkAge is the registered evaluator
    if (await isArkAgeEvaluator(jobId)) {
        const tier = await loadJobTier(jobId);
        await startEvaluatorChild(jobId, tier);
    }

    // Phase 4: wait for terminal state
    const terminal = await awaitChainEventWithRescue<{ status: JobStatusEnum }>({
        hookToken: jobTerminalToken(jobId),
        pollChainState: () => pollJobState(jobId),
        isAdvancedPredicate: (s) => isTerminalState(s),
        expiredAtSec,
    });

    if (terminal.kind === "expired") {
        await tryClaimRefund(jobId);
        await recordWorkflowComplete("expired_unevaluated_refunded");
        return { outcome: "expired_unevaluated_refunded" };
    }

    const finalStatus =
        terminal.kind === "rescued"
            ? terminal.chainState
            : await pollJobState(jobId);
    await recordWorkflowComplete(finalStatus.toLowerCase());
    return { outcome: finalStatus.toLowerCase() };
}
