import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { start } from "workflow/api";
import { x402DisputeFlow } from "@/workflows/x402-dispute-flow";

const Input = z.object({
    receiptId: z.string().regex(/^[0-9]+$/),
    reason: z.string().min(1).max(1000),
    evidence: z.unknown().optional(),
    idempotencyKey: z.string().min(1),
});

interface DisputeOutput {
    disputeId: string;
    workflowRunId: string;
}

/**
 * arkage:dispute_receipt — buyer opens a dispute against an x402
 * receipt. Spawns `x402DisputeFlow` (Plan B Phase 12) which loads
 * the receipt, re-attempts the seller's endpoint, and applies a
 * deterministic resolution matrix (refund / no_refund / manual_review).
 *
 * Auth gate: only the on-chain buyer wallet attached to the receipt
 * may dispute it (matches `ctx.actingWalletAddress`).
 */
export async function handleDisputeReceipt(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<DisputeOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const receipt = await db.x402Receipt.findUnique({
        where: { id: BigInt(parse.data.receiptId) },
    });
    if (!receipt) return err("not_found", "receipt not found");

    const buyerWalletHex =
        "0x" + Buffer.from(receipt.buyerWallet).toString("hex");
    if (
        buyerWalletHex.toLowerCase() !==
        ctx.actingWalletAddress.toLowerCase()
    ) {
        return err(
            "not_authorized",
            "only the buyer of this receipt may dispute",
        );
    }

    const dispute = await db.x402Dispute.create({
        data: {
            receiptId: receipt.id,
            raisedByWallet: receipt.buyerWallet,
            reason: parse.data.reason,
            ...(parse.data.evidence !== undefined && {
                evidenceJsonb: parse.data.evidence as object,
            }),
            status: "open",
            workflowRunId: "pending",
        },
    });

    const run = await start(x402DisputeFlow, [dispute.id, receipt.id]);
    await db.x402Dispute.update({
        where: { id: dispute.id },
        data: { workflowRunId: run.runId },
    });

    return ok({
        disputeId: dispute.id.toString(),
        workflowRunId: run.runId,
    });
}

registerTool({
    name: "arkage:dispute_receipt",
    description:
        "Open a dispute against an x402 receipt; spawns x402DisputeFlow",
    inputSchema: {
        type: "object",
        properties: {
            receiptId: { type: "string" },
            reason: { type: "string" },
            evidence: {},
            idempotencyKey: { type: "string" },
        },
        required: ["receiptId", "reason", "idempotencyKey"],
    },
    handler: handleDisputeReceipt,
});
