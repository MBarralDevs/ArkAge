import { z } from "zod";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { encodeIdentityRegister } from "@/lib/erc-8004";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import type { PendingTier1Signature } from "@/lib/tier1-modular";

/**
 * arkage:register_agent_onchain — Plan E2 Task 5.
 *
 * First step of the two-tx on-chain anchoring flow. Returns the unsigned
 * `IdentityRegistry.register(metadataURI)` envelope for the dashboard to
 * sign with the builder's Tier 1 (passkey) wallet and broadcast.
 *
 * After the tx lands and emits `Transfer(0x0, tier1, tokenId)`, the
 * dashboard calls `arkage:complete_onchain_registration` with the tx
 * hash; that tool parses the token id and returns Tx 2's envelope.
 *
 * Idempotency: refuses to run when the agent is already on-chain
 * anchored (`agent.chainAgentId IS NOT NULL`). For retries after a Tx 1
 * broadcast failed, the dashboard can resubmit (the encoded calldata is
 * deterministic given the same `metadataURI`).
 */

const Input = z.object({
    agentDbId: z.string().regex(/^[0-9]+$/),
    /**
     * URI pointing to the agent's metadata document. ERC-8004 doesn't
     * mandate a specific scheme. For Arc Testnet we default to an
     * inline:// scheme that callers can resolve to the agent's row in
     * ArkAge's DB; mainnet flows should pass an IPFS / Vercel Blob URI.
     */
    metadataURI: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
});

interface Output {
    state: "awaiting_tx1";
    agentDbId: string;
    metadataURI: string;
    pendingActions: PendingTier1Signature[];
}

export async function handleRegisterAgentOnchain(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);
    const input = parse.data;

    const agent = await db.agent.findUnique({
        where: { id: BigInt(input.agentDbId) },
        include: { currentOperatorWallet: true },
    });
    if (!agent) return err("agent_not_found", `dbId=${input.agentDbId}`);

    if (agent.currentOperatorWallet.builderId !== ctx.builderId) {
        return err(
            "forbidden",
            "this agent is not owned by the calling builder",
        );
    }
    if (agent.chainAgentId !== null) {
        return err(
            "already_anchored",
            `agent dbId=${input.agentDbId} is already on-chain at token id ${agent.chainAgentId}`,
        );
    }

    const metadataURI =
        input.metadataURI ?? `inline://arkage/agent/${agent.id}`;
    const calldata: Hex = encodeIdentityRegister(metadataURI);

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: ctx.actingWalletAddress,
            action: "register_agent_onchain.request",
            targetKind: "agent",
            targetId: input.agentDbId,
            payloadJsonb: {
                metadataURI,
                idempotencyKey: input.idempotencyKey,
            } as object,
        },
    });

    const pendingAction: PendingTier1Signature = {
        kind: "tier1_signature_required",
        reason: "identity_op",
        unsignedTx: {
            to: ARC_TESTNET_ADDRESSES.ERC_8004_IDENTITY_REGISTRY as Address,
            data: calldata,
            value: "0",
        },
    };

    return ok({
        state: "awaiting_tx1",
        agentDbId: input.agentDbId,
        metadataURI,
        pendingActions: [pendingAction],
    });
}

registerTool({
    name: "arkage:register_agent_onchain",
    description:
        "Begin on-chain anchoring of an agent: returns the unsigned IdentityRegistry.register() tx envelope for the builder's Tier 1 wallet to sign",
    inputSchema: {
        type: "object",
        properties: {
            agentDbId: { type: "string" },
            metadataURI: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["agentDbId", "idempotencyKey"],
    },
    handler: handleRegisterAgentOnchain,
});
