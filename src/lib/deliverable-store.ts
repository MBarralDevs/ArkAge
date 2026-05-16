import { put } from "@vercel/blob";
import { keccak256, toBytes } from "viem";

/**
 * Deliverable storage — the provider side of a job's artifact pair.
 *
 * When a provider calls `arkage:submit_work` with the work product,
 * ArkAge hashes it, stores it hash-addressed in Vercel Blob, and submits
 * that hash as ERC-8183's `bytes32 deliverable`. The evaluator later
 * fetches the content by hash and re-verifies keccak256(content) ===
 * hash, so ArkAge is only trusted for availability, never integrity —
 * the same trust model as the evaluator-evidence store.
 *
 * The Blob path is deterministic (`deliverables/<hash>`, no random
 * suffix), so a consumer holding only the on-chain hash can locate the
 * content via `ARKAGE_DELIVERABLE_GATEWAY` + hash.
 */

/** keccak256 of the deliverable's UTF-8 bytes — the bytes32 committed on-chain. */
export function deliverableHashOf(content: string): `0x${string}` {
    return keccak256(toBytes(content));
}

/**
 * Persist deliverable content to Vercel Blob, hash-addressed. Idempotent:
 * an identical re-submission lands on the same path with the same bytes.
 */
export async function persistDeliverable(
    content: string,
): Promise<{ uri: string; hash: `0x${string}` }> {
    const hash = deliverableHashOf(content);
    const blob = await put(`deliverables/${hash}`, content, {
        access: "public",
        contentType: "text/plain; charset=utf-8",
        addRandomSuffix: false,
    });
    return { uri: blob.url, hash };
}
