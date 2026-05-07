import { put } from "@vercel/blob";
import { keccak256, toHex } from "viem";

/**
 * Evaluator evidence storage + canonical hashing.
 *
 * Per spec §2.4 the evaluator's reasoning, verdict, and inputs are
 * recorded off-chain in Vercel Blob and bound to the job by hash:
 * keccak256(canonicalJSON(record)) is what flows into ERC-8183's
 * `bytes32 reason` parameter, AND into ERC-8004's `feedbackHash`.
 *
 * The same hash thread lets anyone call `arkage:verify_evidence` to
 * fetch the blob and recompute — proving the evaluator's stated
 * reasoning matches what was committed on-chain.
 */

export interface EvidenceRecord {
    model: string;
    verdict: "accept" | "reject";
    reasoning: string;
    deliverableHash: string;
    inputTokens?: number;
    outputTokens?: number;
    promptVersion?: string;
    promptHash?: string;
    structuredResponse?: unknown;
}

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        }
        return sorted;
    }
    return value;
}

export function canonicalEvidenceJson(record: EvidenceRecord): string {
    return JSON.stringify(sortKeysDeep(record));
}

export function evidenceHash(record: EvidenceRecord): `0x${string}` {
    return keccak256(toHex(canonicalEvidenceJson(record)));
}

/**
 * Persist canonical evidence to Vercel Blob and return the public URL +
 * the hash. The path embeds jobId + hash so a duplicate persistence is
 * a no-op (blob put is idempotent on identical content + path).
 */
export async function persistEvidence(
    jobId: bigint,
    record: EvidenceRecord,
): Promise<{ uri: string; hash: `0x${string}` }> {
    const canonical = canonicalEvidenceJson(record);
    const hash = evidenceHash(record);
    const path = `evidence/${jobId}/${hash}.json`;
    const blob = await put(path, canonical, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
    });
    return { uri: blob.url, hash };
}
