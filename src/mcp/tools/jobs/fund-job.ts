import { z } from "zod";
import { encodeFunctionData, parseAbi } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI, AGENT_REGISTRY_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { buildMulticall } from "@/lib/multicall";
import { executeTier2Call } from "@/lib/tier2-dispatch";
import { evaluatePolicy } from "@/lib/policy-engine";
import { route } from "@/lib/wallet-router";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { publicClient } from "@/lib/chain";

/**
 * arkage:fund_job — client funds a job and atomically records the
 * evaluator fee in one tx (Multicall3 batch: ERC8183.fund +
 * AgentRegistry.recordJobFee).
 *
 * Fee schedule per spec §2.6:
 *   fast     → max(5% of budget, 100k base)
 *   standard → min(2% of budget, 1M cap)
 *   premium  → min(1% of budget, 5M cap)
 *
 * All values in USDC raw units (6 decimals).
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    budget: z.string().regex(/^[0-9]+$/),
    evaluatorTier: z.enum(["fast", "standard", "premium"]),
    idempotencyKey: z.string().min(1),
});

function computeFee(budget: bigint, tier: "fast" | "standard" | "premium"): bigint {
    switch (tier) {
        case "fast": {
            const flat = 100_000n;
            const pct = budget / 20n; // 5%
            return pct > flat ? pct : flat;
        }
        case "standard": {
            const cap = 1_000_000n;
            const pct = budget / 50n; // 2%
            return pct < cap ? pct : cap;
        }
        case "premium": {
            const cap = 5_000_000n;
            const pct = budget / 100n; // 1%
            return pct < cap ? pct : cap;
        }
    }
}

export async function handleFundJob(
    rawInput: unknown,
): Promise<Result<{ transactionId: string; state: string; fee: string }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const budget = BigInt(parse.data.budget);
    const fee = computeFee(budget, parse.data.evaluatorTier);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    const verdict = await evaluatePolicy({
        agentDbId: agent.dbId,
        policy: agent.policy,
        action: "fund_job",
        amount: budget,
        contractTarget: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
    });
    if (!verdict.ok) return err(verdict.code, verdict.message);

    const decision = route({
        kind: "fund_job",
        amount: budget,
        agent: {
            agentId: agent.agentId,
            operatorWallet: agent.operatorWallet,
            perTxCap: agent.perTxCap,
            active: agent.active,
            ...(agent.tier2Kind ? { tier2Kind: agent.tier2Kind } : {}),
        },
    });
    if ("reject" in decision) return err("routing_rejected", decision.reason);
    if (decision.wallet === "tier1-modular") {
        return err(
            "routing_requires_tier1",
            `Tier 1 signature required: ${decision.reason}`,
        );
    }
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

    if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) return err("config_error", "AGENT_REGISTRY missing");

    // AgentRegistry.recordJobFee reverts with ClientNotRegistered() if the
    // calling operator wallet has no on-chain agent binding. Most v1
    // testnet builders haven't anchored yet (ERC-8004 + AgentRegistry is
    // Plan E2 and gated on Tier 1 passkey signing). Probe before batching
    // so non-anchored clients still get to fund — they just don't get the
    // atomic on-chain fee record. DB-side evaluatorFee is written either
    // way below.
    const onchainClientAgentId = (await publicClient.readContract({
        address: ARKAGE_ADDRESSES.AGENT_REGISTRY,
        abi: parseAbi([
            "function agentIdByOperator(address) view returns (uint256)",
        ]),
        functionName: "agentIdByOperator",
        args: [agent.operatorWallet],
    })) as bigint;

    let to: `0x${string}`;
    let data: `0x${string}`;
    if (onchainClientAgentId > 0n) {
        const mc = buildMulticall([
            {
                target: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
                abi: ERC8183_ABI,
                functionName: "fund",
                args: [BigInt(parse.data.jobId), "0x"],
            },
            {
                target: ARKAGE_ADDRESSES.AGENT_REGISTRY,
                abi: AGENT_REGISTRY_ABI,
                functionName: "recordJobFee",
                args: [BigInt(parse.data.jobId), fee],
            },
        ]);
        to = mc.to;
        data = mc.data;
    } else {
        to = ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE;
        data = encodeFunctionData({
            abi: ERC8183_ABI,
            functionName: "fund",
            args: [BigInt(parse.data.jobId), "0x"],
        });
    }

    const dispatch = await executeTier2Call({
        agent,
        to,
        data,
    });
    if (!dispatch.ok) return err(dispatch.code, dispatch.message);

    await db.job.updateMany({
        where: { jobId: parse.data.jobId },
        data: { evaluatorTier: parse.data.evaluatorTier, evaluatorFee: fee.toString() },
    });

    return ok({
        transactionId: dispatch.transactionId,
        state: dispatch.state,
        fee: fee.toString(),
    });
}

registerTool({
    name: "arkage:fund_job",
    description:
        "Fund an ERC-8183 job and record the evaluator fee in the same tx via Multicall3",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            budget: { type: "string" },
            evaluatorTier: { type: "string", enum: ["fast", "standard", "premium"] },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "budget", "evaluatorTier", "idempotencyKey"],
    },
    handler: handleFundJob,
});
