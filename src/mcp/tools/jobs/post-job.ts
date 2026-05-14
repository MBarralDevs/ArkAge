import { z } from "zod";
import {
    decodeEventLog,
    encodeFunctionData,
    keccak256,
    parseAbiItem,
    toBytes,
    type Address,
    type Hex,
} from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { executeTier2Call } from "@/lib/tier2-dispatch";
import { waitForTxHash } from "@/lib/tier2-dcw";
import { publicClient, CHAIN_ID as ARC_CHAIN_ID } from "@/lib/chain";
import { route } from "@/lib/wallet-router";
import { evaluatePolicy } from "@/lib/policy-engine";
import { loadAgentByDbId } from "@/lib/agent-loader";
import {
    handleJobCreated,
    type ContractEventNotification,
} from "@/workers/ingest-circle-event";

const JOB_CREATED_EVENT = parseAbiItem(
    "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
);
const JOB_CREATED_TOPIC = keccak256(
    toBytes(
        "JobCreated(uint256,address,address,address,uint256,address)",
    ),
);

/**
 * Optimistic post-flight: turn the freshly-broadcast createJob tx into a
 * Job row in the DB before this MCP call returns, so the caller can act
 * on the on-chain jobId immediately. Resolves the txHash from either
 * signing path (external-EOA broadcasts directly, Circle DCW gets queued
 * and gives us a hash via `waitForTxHash`), waits for the receipt,
 * decodes JobCreated, and pipes it through the same `handleJobCreated`
 * path the goldsky normalizer uses. Best-effort: the every-minute
 * normalizer cron is the safety net.
 */
async function landJobOptimistically(args: {
    queuedTxId: string;
    state: string;
}): Promise<{ jobId: string | null; txHash: Hex | null }> {
    let txHash: Hex;
    if (args.state === "SENT") {
        txHash = args.queuedTxId as Hex;
    } else {
        txHash = await waitForTxHash(args.queuedTxId, {
            timeoutMs: 30_000,
            pollMs: 1_500,
        });
    }
    const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 30_000,
    });
    if (receipt.status !== "success") return { jobId: null, txHash };

    const log = receipt.logs.find(
        (l) =>
            l.address.toLowerCase() ===
                ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE.toLowerCase() &&
            l.topics[0] === JOB_CREATED_TOPIC,
    );
    if (!log) return { jobId: null, txHash };

    const decoded = decodeEventLog({
        abi: [JOB_CREATED_EVENT],
        topics: log.topics,
        data: log.data,
    });
    const args2 = decoded.args as unknown as {
        jobId: bigint;
        client: Address;
        provider: Address;
        evaluator: Address;
        expiredAt: bigint;
        hook: Address;
    };

    const params: Record<string, string> = {
        jobId: args2.jobId.toString(),
        client: args2.client,
        provider: args2.provider,
        evaluator: args2.evaluator,
        expiredAt: args2.expiredAt.toString(),
        hook: args2.hook,
    };

    const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
    });
    const notif: ContractEventNotification = {
        contractAddress: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        eventName: "JobCreated",
        txHash,
        logIndex: log.logIndex ?? 0,
        blockNumber: receipt.blockNumber.toString(),
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
        params,
    };

    // handleJobCreated upserts on jobId, so the eventual cron-driven
    // delivery is a no-op. It also spawns jobLifecycle idempotently.
    await handleJobCreated(notif);

    return { jobId: args2.jobId.toString(), txHash };
}

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
    txHash: string | null;
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
            ...(agent.tier2Kind ? { tier2Kind: agent.tier2Kind } : {}),
        },
    });
    if ("reject" in decision) return err("routing_rejected", decision.reason);
    if (
        decision.wallet !== "tier2-dcw" &&
        decision.wallet !== "tier2-external-eoa" &&
        decision.wallet !== "tier2-circle-agent-wallet"
    ) {
        return err(
            "routing_unexpected",
            `expected a tier-2 wallet, got ${decision.wallet}`,
        );
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

    const dispatch = await executeTier2Call({
        agent,
        to: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        data: callData,
    });
    if (!dispatch.ok) return err(dispatch.code, dispatch.message);

    // Optimistic insert: try to land the Job row + spawn the workflow
    // before this call returns. Best-effort — the every-minute goldsky
    // normalizer cron is the safety net if any step times out.
    let optimistic: { jobId: string | null; txHash: Hex | null } = {
        jobId: null,
        txHash: null,
    };
    try {
        optimistic = await landJobOptimistically({
            queuedTxId: dispatch.transactionId,
            state: dispatch.state,
        });
    } catch (e) {
        console.warn(
            "[post_job] optimistic land failed, falling back to cron normalizer",
            e instanceof Error ? e.message : String(e),
        );
    }

    await db.auditLog.create({
        data: {
            actorKind: "agent",
            actorId: agent.agentId.toString(),
            action: "post_job",
            payloadJsonb: {
                circleTransactionId: dispatch.transactionId,
                circleState: dispatch.state,
                jobId: optimistic.jobId,
                txHash: optimistic.txHash,
                chainId: ARC_CHAIN_ID,
                idempotencyKey: parse.data.idempotencyKey,
            } as object,
        },
    });

    return ok({
        jobId: optimistic.jobId,
        txHash: optimistic.txHash,
        createTransactionId: dispatch.transactionId,
        createTxState: dispatch.state,
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
