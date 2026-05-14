import { z } from "zod";
import { encodeFunctionData } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { executeTier2Call } from "@/lib/tier2-dispatch";
import { loadAgentByDbId } from "@/lib/agent-loader";

/**
 * arkage:submit_work — provider posts the deliverable hash to ERC-8183.
 *
 * `deliverableHash` is the keccak256 of the canonical deliverable
 * payload (bytes32). Off-chain the actual deliverable is stored in
 * Vercel Blob; the hash is what binds it to the on-chain job state.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    deliverableHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    idempotencyKey: z.string().min(1),
});

export async function handleSubmitWork(
    rawInput: unknown,
): Promise<Result<{ transactionId: string; state: string }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "submit",
        args: [
            BigInt(parse.data.jobId),
            parse.data.deliverableHash as `0x${string}`,
            "0x",
        ],
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
    name: "arkage:submit_work",
    description: "Provider submits the deliverable hash to ERC-8183",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            deliverableHash: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "deliverableHash", "idempotencyKey"],
    },
    handler: handleSubmitWork,
});
