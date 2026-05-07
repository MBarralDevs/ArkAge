import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { AGENT_REGISTRY_ABI } from "@/lib/abis";
import { ARKAGE_ADDRESSES } from "@/lib/addresses";
import type { PendingTier1Signature } from "@/lib/tier1-modular";

/**
 * arkage:revoke_agent — fast-path revocation.
 *
 * Off-chain revocation is immediate: the wallet is marked `revoked` and
 * the agent is marked `active=false`, so the MCP server stops honoring
 * any further calls from the operator wallet. The on-chain
 * `AgentRegistry.deactivate(agentId)` requires a Tier 1 signature
 * (only the identity owner can deactivate) — we return the unsigned
 * tx envelope as a `pendingActions` entry for the dashboard to sign.
 *
 * Order matters: off-chain flip MUST land before the on-chain tx is
 * submitted, so a long-running call mid-revocation can't sneak through.
 */

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

interface RevokeOutput {
    pendingActions: PendingTier1Signature[];
}

export async function handleRevokeAgent(rawInput: unknown): Promise<Result<RevokeOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
    if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);
    if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) {
        return err("config_error", "ARKAGE_AGENT_REGISTRY_ADDRESS not set");
    }

    await db.wallet.update({
        where: { id: agent.currentOperatorWalletId },
        data: { status: "revoked" },
    });
    await db.agent.update({ where: { id: agent.id }, data: { active: false } });

    const data = encodeFunctionData({
        abi: AGENT_REGISTRY_ABI,
        functionName: "deactivate",
        args: [BigInt(parse.data.agentId)],
    });

    return ok({
        pendingActions: [
            {
                kind: "tier1_signature_required",
                reason: "revocation",
                unsignedTx: {
                    to: ARKAGE_ADDRESSES.AGENT_REGISTRY as Address,
                    data,
                    value: "0",
                },
            },
        ],
    });
}

registerTool({
    name: "arkage:revoke_agent",
    description:
        "Mark agent inactive off-chain immediately; return a Tier 1 signature intent for AgentRegistry.deactivate",
    inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
    },
    handler: handleRevokeAgent,
});
