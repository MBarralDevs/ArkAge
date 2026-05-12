import { z } from "zod";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { publicClient } from "@/lib/chain";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import {
    encodeAgentRegistryRegister,
    parseTokenIdFromTransferLogs,
} from "@/lib/erc-8004";
import type { PendingTier1Signature } from "@/lib/tier1-modular";
import { hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";

/**
 * arkage:complete_onchain_registration — Plan E2 Task 6.
 *
 * Second hop: takes the IdentityRegistry.register tx hash that the dashboard
 * just broadcast, polls the receipt, extracts the freshly-minted token id
 * from the Transfer event, writes it to the agent row, and returns the
 * unsigned AgentRegistry.registerAgent envelope (Tx 2) to be signed by the
 * same Tier 1 wallet.
 *
 * Three terminal states the caller has to handle:
 *   - "tx1_pending"   — receipt not available yet (tx not mined). Retry.
 *   - "tx1_no_mint"   — receipt landed but no mint Transfer event matched.
 *                       Likely the wrong tx hash; surface to the user.
 *   - "awaiting_tx2"  — token id captured, Tx 2 envelope returned.
 */

const Input = z.object({
    agentDbId: z.string().regex(/^[0-9]+$/),
    identityRegisterTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    idempotencyKey: z.string().min(1),
});

type Output =
    | {
          state: "tx1_pending";
          agentDbId: string;
          /** seconds the dashboard should wait before retrying */
          retryAfter: number;
      }
    | {
          state: "tx1_no_mint";
          agentDbId: string;
          reason: string;
      }
    | {
          state: "awaiting_tx2";
          agentDbId: string;
          chainAgentId: string;
          pendingActions: PendingTier1Signature[];
      };

export async function handleCompleteOnchainRegistration(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);
    const input = parse.data;

    const agent = await db.agent.findUnique({
        where: { id: BigInt(input.agentDbId) },
        include: {
            currentOperatorWallet: true,
            policies: {
                where: { validTo: null },
                orderBy: { version: "desc" },
                take: 1,
            },
        },
    });
    if (!agent) return err("agent_not_found", `dbId=${input.agentDbId}`);
    if (agent.currentOperatorWallet.builderId !== ctx.builderId) {
        return err("forbidden", "agent not owned by calling builder");
    }
    const policy = agent.policies[0];
    if (!policy) return err("no_active_policy", "agent has no active policy");

    // Idempotency: re-issuing for an already-anchored agent just returns the
    // existing chainAgentId rather than racing for another token.
    if (agent.chainAgentId !== null) {
        return ok({
            state: "awaiting_tx2",
            agentDbId: input.agentDbId,
            chainAgentId: agent.chainAgentId.toString(),
            pendingActions: [
                buildTx2Envelope({
                    chainAgentId: BigInt(agent.chainAgentId),
                    operator: addressFrom(agent.currentOperatorWallet.address),
                    policy: policy.bodyJsonb as unknown as AgentPolicy,
                }),
            ],
        });
    }

    let receipt;
    try {
        receipt = await publicClient.getTransactionReceipt({
            hash: input.identityRegisterTxHash as Hex,
        });
    } catch {
        // viem throws when receipt isn't available — treat as pending.
        return ok({
            state: "tx1_pending",
            agentDbId: input.agentDbId,
            retryAfter: 5,
        });
    }

    if (receipt.status !== "success") {
        return ok({
            state: "tx1_no_mint",
            agentDbId: input.agentDbId,
            reason: `Tx 1 reverted on-chain (status=${receipt.status})`,
        });
    }

    const tokenId = parseTokenIdFromTransferLogs(
        receipt.logs,
        ARC_TESTNET_ADDRESSES.ERC_8004_IDENTITY_REGISTRY,
    );
    if (tokenId === null) {
        return ok({
            state: "tx1_no_mint",
            agentDbId: input.agentDbId,
            reason: `No mint Transfer event from IdentityRegistry in tx ${input.identityRegisterTxHash}`,
        });
    }

    await db.agent.update({
        where: { id: agent.id },
        data: {
            chainAgentId: tokenId,
            identityRegisterTxHash: Buffer.from(
                input.identityRegisterTxHash.slice(2),
                "hex",
            ),
        },
    });

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: ctx.actingWalletAddress,
            action: "register_agent_onchain.tx1_confirmed",
            targetKind: "agent",
            targetId: input.agentDbId,
            payloadJsonb: {
                chainAgentId: tokenId.toString(),
                txHash: input.identityRegisterTxHash,
                idempotencyKey: input.idempotencyKey,
            } as object,
        },
    });

    return ok({
        state: "awaiting_tx2",
        agentDbId: input.agentDbId,
        chainAgentId: tokenId.toString(),
        pendingActions: [
            buildTx2Envelope({
                chainAgentId: tokenId,
                operator: addressFrom(agent.currentOperatorWallet.address),
                policy: policy.bodyJsonb as unknown as AgentPolicy,
            }),
        ],
    });
}

function addressFrom(bytes: Uint8Array | Buffer): Address {
    return ("0x" + Buffer.from(bytes).toString("hex")) as Address;
}

function buildTx2Envelope(args: {
    chainAgentId: bigint;
    operator: Address;
    policy: AgentPolicy;
}): PendingTier1Signature {
    const target = ARKAGE_ADDRESSES.AGENT_REGISTRY;
    if (!target) {
        // Should never happen if Plan A deploys are pinned in env; surface
        // loudly if it does so we can configure rather than silently 0x0.
        throw new Error(
            "ARKAGE_AGENT_REGISTRY_ADDRESS env var is not set; cannot build Tx 2",
        );
    }
    const data = encodeAgentRegistryRegister({
        chainAgentId: args.chainAgentId,
        operator: args.operator,
        policyHash: hashPolicy(args.policy) as Hex,
        perTxCap: BigInt(args.policy.spendCaps.perTx),
        evaluatorFeeMax: BigInt(
            args.policy.evaluatorPreferences.maxFeePerJob,
        ),
    });
    return {
        kind: "tier1_signature_required",
        reason: "identity_op",
        unsignedTx: {
            to: target,
            data,
            value: "0",
        },
    };
}

registerTool({
    name: "arkage:complete_onchain_registration",
    description:
        "After IdentityRegistry.register tx lands, parse the minted token id and return the AgentRegistry.registerAgent envelope to sign next",
    inputSchema: {
        type: "object",
        properties: {
            agentDbId: { type: "string" },
            identityRegisterTxHash: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["agentDbId", "identityRegisterTxHash", "idempotencyKey"],
    },
    handler: handleCompleteOnchainRegistration,
});
