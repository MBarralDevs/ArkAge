import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { evidenceHash, type EvidenceRecord } from "@/lib/evidence-store";

/**
 * arkage:verify_evidence — public verification of evaluator evidence.
 *
 * Fetches the evidence blob URL from the latest evaluation row, hashes
 * the canonical JSON, and compares against the on-chain `reasonHash`
 * stored in the job row. A match proves the evaluator's reasoning
 * commitment matches what flowed into ERC-8183.complete/reject.
 *
 * This is the public-facing verification primitive that lets anyone
 * audit ArkAge evaluator decisions without trusting us.
 */

const Input = z.object({ jobId: z.string().regex(/^[0-9]+$/) });

interface VerifyOutput {
    onChainReasonHash: string | null;
    fetchedEvidenceURI: string | null;
    computedHash: string | null;
    matches: boolean;
}

export async function handleVerifyEvidence(
    rawInput: unknown,
): Promise<Result<VerifyOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const job = await db.job.findUnique({
        where: { jobId: parse.data.jobId },
        include: { evaluations: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!job) return err("not_found", `job ${parse.data.jobId} not found`);

    const onChain = job.reasonHash
        ? "0x" + Buffer.from(job.reasonHash).toString("hex")
        : null;
    const evalRow = job.evaluations[0];
    if (!evalRow) {
        return ok({
            onChainReasonHash: onChain,
            fetchedEvidenceURI: null,
            computedHash: null,
            matches: false,
        });
    }

    const res = await fetch(evalRow.evidenceUri);
    if (!res.ok) {
        return err("evidence_fetch_failed", `${res.status} ${res.statusText}`);
    }
    const fetched = (await res.json()) as EvidenceRecord;

    const recomputed = evidenceHash(fetched);
    const matches = onChain === recomputed;

    return ok({
        onChainReasonHash: onChain,
        fetchedEvidenceURI: evalRow.evidenceUri,
        computedHash: recomputed,
        matches,
    });
}

registerTool({
    name: "arkage:verify_evidence",
    description:
        "Public verification: fetch evaluator evidence, recompute hash, confirm on-chain match",
    inputSchema: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
    },
    handler: handleVerifyEvidence,
});
