import { z } from "zod";
import { encodeFunctionData } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { loadAgentByDbId } from "@/lib/agent-loader";

/**
 * arkage:set_budget — provider commits a budget on an Open job.
 *
 * Triggers ERC-8183 setBudget; the hook chain (PolicyHook) gates by
 * the provider's per-tx cap. After this lands the job moves to Funded
 * state when the client funds it.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    amount: z.string().regex(/^[0-9]+$/),
    idempotencyKey: z.string().min(1),
});

export async function handleSetBudget(
    rawInput: unknown,
): Promise<Result<{ transactionId: string; state: string }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(agent.operatorWallet.toLowerCase().replace(/^0x/, ""), "hex"),
        },
    });
    if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "setBudget",
        args: [BigInt(parse.data.jobId), BigInt(parse.data.amount), "0x"],
    });

    const queued = await signWithTier2(
        wallet.circleWalletId,
        ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        callData,
    );
    return ok({ transactionId: queued.transactionId, state: queued.state });
}

registerTool({
    name: "arkage:set_budget",
    description: "Provider sets the budget on an Open job",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            amount: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "amount", "idempotencyKey"],
    },
    handler: handleSetBudget,
});
