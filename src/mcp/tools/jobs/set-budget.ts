import { z } from "zod";
import { encodeFunctionData } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { executeTier2Call } from "@/lib/tier2-dispatch";
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

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "setBudget",
        args: [BigInt(parse.data.jobId), BigInt(parse.data.amount), "0x"],
    });

    const dispatch = await executeTier2Call({
        agent,
        to: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        data: callData,
    });
    if (!dispatch.ok) return err(dispatch.code, dispatch.message);
    return ok({ transactionId: dispatch.transactionId, state: dispatch.state });
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
