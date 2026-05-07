import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { route } from "@/lib/wallet-router";
import { evaluatePolicy } from "@/lib/policy-engine";
import { loadAgentByDbId } from "@/lib/agent-loader";

/**
 * arkage:post_job — caller posts an ERC-8183 job.
 *
 * Routing: gates via off-chain policy + wallet router (must be Tier 2).
 * Signs ERC8183.createJob via Tier 2 DCW. Returns the queued Circle
 * transaction reference; the on-chain `jobId` is not known until the
 * tx confirms and Goldsky surfaces the JobCreated event, so the
 * jobLifecycle workflow is spawned from the ingest worker (Plan B
 * Tasks 31-32), not here.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    provider: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional(),
    evaluator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    evaluatorTier: z.enum(["fast", "standard", "premium"]).optional(),
    expiredAtSec: z.number().int().positive(),
    description: z.string(),
    budgetMin: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    hook: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional(),
    idempotencyKey: z.string().min(1),
});

interface PostJobOutput {
    jobId: string | null;
    createTransactionId: string;
    createTxState: string;
}

export async function handlePostJob(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<PostJobOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    const policyVerdict = await evaluatePolicy({
        agentDbId: agent.dbId,
        policy: agent.policy,
        action: "post_job",
        contractTarget: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
    });
    if (!policyVerdict.ok) return err(policyVerdict.code, policyVerdict.message);

    const decision = route({
        kind: "post_job",
        agent: {
            agentId: agent.agentId,
            operatorWallet: agent.operatorWallet,
            perTxCap: agent.perTxCap,
            active: agent.active,
        },
    });
    if ("reject" in decision) return err("routing_rejected", decision.reason);
    if (decision.wallet !== "tier2-dcw") {
        return err("routing_unexpected", `expected tier2-dcw, got ${decision.wallet}`);
    }

    const hookAddr = (parse.data.hook ?? ARKAGE_ADDRESSES.HOOK_COMPOSER) as
        | Address
        | undefined;
    if (!hookAddr) return err("config_error", "HOOK_COMPOSER not configured and no hook supplied");

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "createJob",
        args: [
            (parse.data.provider ??
                "0x0000000000000000000000000000000000000000") as Address,
            parse.data.evaluator as Address,
            BigInt(parse.data.expiredAtSec),
            parse.data.description,
            hookAddr,
        ],
    });

    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(agent.operatorWallet.toLowerCase().replace(/^0x/, ""), "hex"),
        },
    });
    if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

    const queued = await signWithTier2(
        wallet.circleWalletId,
        ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        callData,
    );

    await db.auditLog.create({
        data: {
            actorKind: "agent",
            actorId: agent.agentId.toString(),
            action: "post_job",
            payloadJsonb: {
                circleTransactionId: queued.transactionId,
                circleState: queued.state,
                idempotencyKey: parse.data.idempotencyKey,
            } as object,
        },
    });

    return ok({
        jobId: null,
        createTransactionId: queued.transactionId,
        createTxState: queued.state,
    });
}

registerTool({
    name: "arkage:post_job",
    description:
        "Post an ERC-8183 job; signs createJob via Tier 2 and returns the queued tx",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            evaluator: { type: "string" },
            expiredAtSec: { type: "number" },
            description: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "evaluator", "expiredAtSec", "description", "idempotencyKey"],
    },
    handler: handlePostJob,
});
