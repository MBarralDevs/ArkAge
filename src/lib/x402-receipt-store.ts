import { db } from "./db";
import type { Address } from "viem";
import { resumeHook } from "workflow/api";
import { x402SessionToken } from "@/workflows/lib/hook-tokens";

/**
 * Persists an x402 receipt to Postgres and notifies the live
 * `x402PaymentSession` workflow via `resumeHook`. Increments
 * `totalCalls` / `totalAmount` on the session row for the dashboard
 * widgets.
 *
 * The hook fire is what wakes the workflow's main loop so it can
 * run the every-10-receipts reputation gate (Plan B Task 29).
 */

export interface RecordReceiptInput {
    sessionDbId: bigint;
    endpointId: bigint;
    amount: bigint;
    paymentSignature: `0x${string}`;
    buyerWallet: Address;
    sellerWallet: Address;
    httpStatus: number;
    responseHash?: `0x${string}`;
    requestHash?: `0x${string}`;
}

export async function recordReceiptForSession(
    input: RecordReceiptInput,
): Promise<{ receiptDbId: bigint; seq: number }> {
    const lastReceipt = await db.x402Receipt.findFirst({
        where: { sessionId: input.sessionDbId },
        orderBy: { seq: "desc" },
        select: { seq: true },
    });
    const nextSeq = (lastReceipt?.seq ?? 0) + 1;

    const created = await db.x402Receipt.create({
        data: {
            sessionId: input.sessionDbId,
            endpointId: input.endpointId,
            paymentKind: "gateway_batched",
            buyerWallet: Buffer.from(
                input.buyerWallet.replace(/^0x/, ""),
                "hex",
            ),
            sellerWallet: Buffer.from(
                input.sellerWallet.replace(/^0x/, ""),
                "hex",
            ),
            amount: input.amount.toString(),
            requestHash: input.requestHash
                ? Buffer.from(input.requestHash.replace(/^0x/, ""), "hex")
                : Buffer.alloc(32),
            responseHash: input.responseHash
                ? Buffer.from(input.responseHash.replace(/^0x/, ""), "hex")
                : null,
            paymentSignature: Buffer.from(
                input.paymentSignature.replace(/^0x/, ""),
                "hex",
            ),
            httpStatus: input.httpStatus,
            facilitatorProcessedAt: new Date(),
            seq: nextSeq,
        },
    });

    await db.x402Session.update({
        where: { id: input.sessionDbId },
        data: {
            totalCalls: { increment: 1 },
            totalAmount: { increment: input.amount.toString() },
        },
    });

    const session = await db.x402Session.findUniqueOrThrow({
        where: { id: input.sessionDbId },
        include: {
            buyerAgent: { select: { agentId: true } },
            sellerAgent: { select: { agentId: true } },
        },
    });
    await resumeHook(
        x402SessionToken(
            BigInt(session.buyerAgent.agentId.toString()),
            BigInt(session.sellerAgent.agentId.toString()),
        ),
        {
            kind: "receipt",
            receipt: {
                sessionDbId: input.sessionDbId.toString(),
                endpointDbId: input.endpointId.toString(),
                paymentSignature: input.paymentSignature,
                amount: input.amount.toString(),
                requestHash: input.requestHash ?? "0x" + "00".repeat(32),
                responseHash: input.responseHash,
                httpStatus: input.httpStatus,
                seq: nextSeq,
            },
        },
    );

    return { receiptDbId: created.id, seq: nextSeq };
}
