import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

/**
 * arkage:respond_to_dispute — Plan E.1 phase 2.2.
 *
 * Counter-party (seller) side of the dispute conversation. The buyer
 * raises via `arkage:dispute_receipt`; the seller responds via this tool
 * with their own evidence. The auto-resolution workflow (Plan B Phase 12)
 * keeps running independently; this lets the seller put their version of
 * events on record before the workflow lands its decision, AND surfaces
 * the response on the public `/disputes/[id]` timeline regardless of how
 * the workflow concludes.
 *
 * Auth:
 *   - Only the on-chain SELLER wallet attached to the receipt may respond
 *     (matches `ctx.actingWalletAddress`). Mirrors the symmetric check
 *     that gates `dispute_receipt` to the buyer wallet.
 *
 * Idempotency:
 *   - First response wins. Subsequent calls return the existing response
 *     state. If a seller wants to add evidence after the fact, they post
 *     a new dispute or wait for manual_review escalation — keeps the
 *     timeline append-only and unambiguous.
 */

const HEX_BYTES32_TX = /^0x[a-fA-F0-9]{64}$/;

const Input = z.object({
    disputeId: z.string().regex(/^[0-9]+$/),
    /** Free-form structured evidence. Indexed verbatim into JSONB. */
    response: z.unknown(),
    /** Optional pointer to an off-chain artifact (e.g. logs, screenshots). */
    artifactHash: z.string().regex(HEX_BYTES32_TX).optional(),
    idempotencyKey: z.string().min(1),
});

interface Output {
    disputeId: string;
    state: "recorded" | "already_responded";
    respondedAt: string;
}

export async function handleRespondToDispute(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const dispute = await db.x402Dispute.findUnique({
        where: { id: BigInt(parse.data.disputeId) },
        include: { receipt: true },
    });
    if (!dispute) return err("not_found", "dispute not found");

    const sellerWalletHex =
        "0x" + Buffer.from(dispute.receipt.sellerWallet).toString("hex");
    if (
        sellerWalletHex.toLowerCase() !==
        ctx.actingWalletAddress.toLowerCase()
    ) {
        return err(
            "not_authorized",
            "only the seller wallet on the disputed receipt may respond",
        );
    }

    // First response wins. Subsequent calls just echo back the recorded
    // state so the client can render the conversation without racing.
    if (dispute.counterpartyRespondedAt !== null) {
        return ok({
            disputeId: dispute.id.toString(),
            state: "already_responded",
            respondedAt: dispute.counterpartyRespondedAt.toISOString(),
        });
    }

    const now = new Date();
    const updated = await db.x402Dispute.update({
        where: { id: dispute.id },
        data: {
            counterpartyResponseJsonb: {
                response: parse.data.response,
                ...(parse.data.artifactHash !== undefined && {
                    artifactHash: parse.data.artifactHash,
                }),
            } as object,
            counterpartyRespondedAt: now,
        },
    });

    await db.auditLog.create({
        data: {
            actorKind: "seller",
            actorId: ctx.actingWalletAddress,
            action: "dispute.responded",
            targetKind: "dispute",
            targetId: dispute.id.toString(),
            payloadJsonb: {
                idempotencyKey: parse.data.idempotencyKey,
                ...(parse.data.artifactHash !== undefined && {
                    artifactHash: parse.data.artifactHash,
                }),
            } as object,
        },
    });

    return ok({
        disputeId: updated.id.toString(),
        state: "recorded",
        respondedAt: now.toISOString(),
    });
}

registerTool({
    name: "arkage:respond_to_dispute",
    description:
        "Seller-side response to an open dispute. Records evidence on the public timeline; auto-resolution workflow keeps running independently.",
    inputSchema: {
        type: "object",
        properties: {
            disputeId: { type: "string" },
            response: {},
            artifactHash: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["disputeId", "response", "idempotencyKey"],
    },
    handler: handleRespondToDispute,
});
