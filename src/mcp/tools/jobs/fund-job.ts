import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI, AGENT_REGISTRY_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { buildMulticall } from "@/lib/multicall";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { evaluatePolicy } from "@/lib/policy-engine";
import { route } from "@/lib/wallet-router";
import { loadAgentByDbId } from "@/lib/agent-loader";

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
        },
    });
    if ("reject" in decision) return err("routing_rejected", decision.reason);
    if (decision.wallet !== "tier2-dcw") {
        return err(
            "routing_requires_tier1",
            `Tier 1 signature required: ${"reason" in decision ? decision.reason : "unknown"}`,
        );
    }

    if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) return err("config_error", "AGENT_REGISTRY missing");

    const multicall = buildMulticall([
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

    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(agent.operatorWallet.toLowerCase().replace(/^0x/, ""), "hex"),
        },
    });
    if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

    const queued = await signWithTier2(wallet.circleWalletId, multicall.to, multicall.data);

    await db.job.updateMany({
        where: { jobId: parse.data.jobId },
        data: { evaluatorTier: parse.data.evaluatorTier, evaluatorFee: fee.toString() },
    });

    return ok({
        transactionId: queued.transactionId,
        state: queued.state,
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
