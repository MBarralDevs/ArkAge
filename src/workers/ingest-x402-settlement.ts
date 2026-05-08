import { db } from "@/lib/db";

/**
 * Circle x402 facilitator webhook ingestion.
 *
 * Three event kinds we route on:
 *   - `batch_completed`  — a batched settlement landed on-chain;
 *     we record the ArkAge surcharge inflow into `treasury_movements`
 *     when configured.
 *   - `settle`           — a single (non-batched) payment settled.
 *   - `refund`           — a refund flowed back to the buyer; mark
 *     the matching x402_receipts row as refunded (sentinel httpStatus=0).
 *
 * Every event also writes an `audit_log` entry for traceability.
 *
 * Idempotency: per-receipt updates use the unique `payment_signature`
 * for matching. Batched-settlement audit entries are not deduped by
 * txHash (Circle is the source of truth and shouldn't redeliver in
 * v1; if redelivery becomes a concern, gate on auditLog presence).
 */

export interface FacilitatorWebhookPayload {
    eventType: string;
    data: {
        paymentSignature?: string;
        settlementTxHash?: string;
        sellerWallet?: string;
        amountTotal?: string;
        receiptsSettled?: string[];
        facilitatorFee?: string;
        settledAt?: string;
    };
}

export async function ingestFacilitatorEvent(
    payload: FacilitatorWebhookPayload,
): Promise<void> {
    if (
        payload.eventType !== "batch_completed" &&
        payload.eventType !== "settle" &&
        payload.eventType !== "refund"
    ) {
        return;
    }

    const { data } = payload;

    await db.auditLog.create({
        data: {
            actorKind: "system",
            actorId: "circle-x402-facilitator",
            action: `x402.${payload.eventType}`,
            targetKind: "settlement",
            targetId: data.settlementTxHash ?? "(none)",
            payloadJsonb: data as unknown as object,
        },
    });

    if (
        payload.eventType === "batch_completed" &&
        data.settlementTxHash &&
        data.sellerWallet &&
        data.amountTotal &&
        process.env.ARKAGE_X402_FEE_BPS &&
        data.facilitatorFee
    ) {
        await db.treasuryMovement.create({
            data: {
                kind: "x402_surcharge",
                sourceKind: "facilitator_batch",
                sourceId: null,
                amount: data.facilitatorFee,
                tokenAddress: Buffer.from(
                    "3600000000000000000000000000000000000000",
                    "hex",
                ),
                direction: "in",
                counterparty: Buffer.from(
                    data.sellerWallet.replace(/^0x/, ""),
                    "hex",
                ),
                txHash: Buffer.from(
                    data.settlementTxHash.replace(/^0x/, ""),
                    "hex",
                ),
                blockTime: data.settledAt
                    ? new Date(data.settledAt)
                    : null,
            },
        });
    }

    if (payload.eventType === "refund" && data.paymentSignature) {
        const sig = Buffer.from(
            data.paymentSignature.replace(/^0x/, ""),
            "hex",
        );
        await db.x402Receipt.updateMany({
            where: { paymentSignature: sig },
            data: { httpStatus: 0 },
        });
    }
}
