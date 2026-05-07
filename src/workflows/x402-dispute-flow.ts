import { db } from "@/lib/db";
import {
    recordWorkflowStart,
    recordWorkflowComplete,
} from "./lib/recording-steps";

/**
 * x402DisputeFlow — auto-resolution for x402 receipt disputes.
 *
 * Spawned by `arkage:open_dispute` MCP tool. Loads the contested
 * receipt, re-attempts the seller's endpoint via HEAD, and applies
 * a deterministic decision matrix:
 *   - persistent 5xx OR 408/504  → refund
 *   - original 2xx and reattempt OK  → no_refund
 *   - anything else  → manual_review (escalates to /admin/disputes in Plan C)
 *
 * No on-chain settlement here in v1 — refunds are tracked off-chain
 * against Circle Gateway's batched settlement. Mainnet migration may
 * lift this into a dispute hook once finalized.
 */

type Resolution = "refund" | "no_refund" | "manual_review";

async function loadReceiptForDispute(receiptDbId: bigint): Promise<{
    url: string;
    amount: string;
    httpStatus: number | null;
    facilitatorProcessedAt: Date;
} | null> {
    "use step";
    console.log(`[dispute] loadReceiptForDispute receiptId=${receiptDbId}`);
    const receipt = await db.x402Receipt.findUnique({
        where: { id: receiptDbId },
        include: { endpoint: true },
    });
    if (!receipt) return null;
    return {
        url: receipt.endpoint.effectiveUrl,
        amount: receipt.amount.toString(),
        httpStatus: receipt.httpStatus,
        facilitatorProcessedAt: receipt.facilitatorProcessedAt,
    };
}

async function reattemptCall(
    url: string,
): Promise<{ status: number; ok: boolean }> {
    "use step";
    console.log(`[dispute] reattemptCall url=${url}`);
    try {
        const res = await fetch(url, { method: "HEAD" });
        return { status: res.status, ok: res.ok };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`[dispute] reattemptCall failed: ${message}`);
        return { status: 0, ok: false };
    }
}

export function decideResolution(opts: {
    originalStatus: number | null;
    reattemptStatus: number;
    reattemptOk: boolean;
}): Resolution {
    if (opts.originalStatus === null) return "manual_review";
    if (opts.originalStatus >= 500 && opts.reattemptStatus >= 500) return "refund";
    if (opts.originalStatus === 408 || opts.originalStatus === 504) return "refund";
    if (
        opts.originalStatus >= 200 &&
        opts.originalStatus < 300 &&
        opts.reattemptOk
    ) {
        return "no_refund";
    }
    return "manual_review";
}

async function applyResolution(
    disputeDbId: bigint,
    resolution: Resolution,
): Promise<void> {
    "use step";
    console.log(
        `[dispute] applyResolution disputeId=${disputeDbId} resolution=${resolution}`,
    );
    const status =
        resolution === "refund"
            ? "resolved_refund"
            : resolution === "no_refund"
              ? "resolved_no_refund"
              : "manual_review";

    await db.x402Dispute.update({
        where: { id: disputeDbId },
        data: {
            status,
            resolvedAt: resolution === "manual_review" ? null : new Date(),
        },
    });
}

export async function x402DisputeFlow(disputeDbId: bigint, receiptDbId: bigint) {
    "use workflow";

    await recordWorkflowStart("dispute", disputeDbId);

    const receipt = await loadReceiptForDispute(receiptDbId);
    if (!receipt) {
        await applyResolution(disputeDbId, "manual_review");
        await recordWorkflowComplete("receipt_missing");
        return { outcome: "receipt_missing" };
    }

    const reattempt = await reattemptCall(receipt.url);
    const resolution = decideResolution({
        originalStatus: receipt.httpStatus,
        reattemptStatus: reattempt.status,
        reattemptOk: reattempt.ok,
    });

    await applyResolution(disputeDbId, resolution);
    await recordWorkflowComplete(resolution);
    return { outcome: resolution };
}
