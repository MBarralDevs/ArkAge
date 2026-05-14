import { z } from "zod";
import { encodeFunctionData } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { executeTier2Call } from "@/lib/tier2-dispatch";
import { loadAgentByDbId } from "@/lib/agent-loader";

/**
 * arkage:claim_refund — anyone may call claimRefund on a Funded or
 * Submitted job past its expiredAt per ERC-8183.
 *
 * Returns the budget back to the original funder. We let any agent
 * trigger this (not just the original funder) since the refund is
 * destination-fixed by the contract; there's no manipulation risk.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    idempotencyKey: z.string().min(1),
});

export async function handleClaimRefund(
    rawInput: unknown,
): Promise<Result<{ transactionId: string; state: string }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "claimRefund",
        args: [BigInt(parse.data.jobId)],
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
    name: "arkage:claim_refund",
    description: "Trigger claimRefund on an expired Funded/Submitted job per ERC-8183",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "idempotencyKey"],
    },
    handler: handleClaimRefund,
});
