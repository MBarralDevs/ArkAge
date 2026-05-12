import { z } from "zod";
import type { Hex } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { publicClient } from "@/lib/chain";
import { ARKAGE_ADDRESSES } from "@/lib/addresses";

/**
 * arkage:finalize_onchain_registration — Plan E2 Task 7.
 *
 * Closes the loop after AgentRegistry.registerAgent (Tx 2) lands. Verifies
 * the receipt status, checks the tx targeted the right contract, and stamps
 * `on_chain_registered_at`. After this call returns success, the agent is
 * fully on-chain anchored — UI shows the "On-chain #<id>" badge, downstream
 * code can rely on `agent.chainAgentId` for ERC-8004 lookups.
 */

const Input = z.object({
    agentDbId: z.string().regex(/^[0-9]+$/),
    agentRegistryTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    idempotencyKey: z.string().min(1),
});

type Output =
    | {
          state: "tx2_pending";
          agentDbId: string;
          retryAfter: number;
      }
    | {
          state: "tx2_reverted";
          agentDbId: string;
          reason: string;
      }
    | {
          state: "complete";
          agentDbId: string;
          chainAgentId: string;
      };

export async function handleFinalizeOnchainRegistration(
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
        return err("forbidden", "agent not owned by calling builder");
    }
    if (agent.chainAgentId === null) {
        return err(
            "tx1_not_recorded",
            "complete_onchain_registration must succeed before finalize",
        );
    }

    // Idempotency: if Tx 2 was already recorded, return the existing state.
    if (agent.agentRegistryTxHash !== null) {
        return ok({
            state: "complete",
            agentDbId: input.agentDbId,
            chainAgentId: agent.chainAgentId.toString(),
        });
    }

    let receipt;
    try {
        receipt = await publicClient.getTransactionReceipt({
            hash: input.agentRegistryTxHash as Hex,
        });
    } catch {
        return ok({
            state: "tx2_pending",
            agentDbId: input.agentDbId,
            retryAfter: 5,
        });
    }

    if (receipt.status !== "success") {
        return ok({
            state: "tx2_reverted",
            agentDbId: input.agentDbId,
            reason: `Tx 2 reverted on-chain (status=${receipt.status})`,
        });
    }

    const expectedTarget = ARKAGE_ADDRESSES.AGENT_REGISTRY?.toLowerCase();
    if (
        expectedTarget &&
        receipt.to &&
        receipt.to.toLowerCase() !== expectedTarget
    ) {
        return ok({
            state: "tx2_reverted",
            agentDbId: input.agentDbId,
            reason: `Tx 2 targeted ${receipt.to}, expected AgentRegistry ${expectedTarget}`,
        });
    }

    await db.agent.update({
        where: { id: agent.id },
        data: {
            agentRegistryTxHash: Buffer.from(
                input.agentRegistryTxHash.slice(2),
                "hex",
            ),
            onChainRegisteredAt: new Date(),
        },
    });

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: ctx.actingWalletAddress,
            action: "register_agent_onchain.tx2_confirmed",
            targetKind: "agent",
            targetId: input.agentDbId,
            payloadJsonb: {
                chainAgentId: agent.chainAgentId.toString(),
                txHash: input.agentRegistryTxHash,
                idempotencyKey: input.idempotencyKey,
            } as object,
        },
    });

    return ok({
        state: "complete",
        agentDbId: input.agentDbId,
        chainAgentId: agent.chainAgentId.toString(),
    });
}

registerTool({
    name: "arkage:finalize_onchain_registration",
    description:
        "Close the on-chain anchoring flow: verifies AgentRegistry.registerAgent landed and stamps the agent as fully on-chain",
    inputSchema: {
        type: "object",
        properties: {
            agentDbId: { type: "string" },
            agentRegistryTxHash: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["agentDbId", "agentRegistryTxHash", "idempotencyKey"],
    },
    handler: handleFinalizeOnchainRegistration,
});
