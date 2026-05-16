import { z } from "zod";
import { encodeFunctionData } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { executeTier2Call } from "@/lib/tier2-dispatch";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { persistDeliverable } from "@/lib/deliverable-store";

/**
 * arkage:submit_work — provider submits the job deliverable.
 *
 * The provider passes the work product itself. ArkAge stores it
 * hash-addressed in Vercel Blob, then commits keccak256(content) as
 * ERC-8183's `bytes32 deliverable`. The evaluator fetches the content
 * by hash and re-verifies — ArkAge is trusted only for availability.
 * Hosting it ArkAge-side guarantees the evaluator can always reach the
 * deliverable (a provider going offline can't strand the job).
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    deliverable: z.string().min(1),
    idempotencyKey: z.string().min(1),
});

interface SubmitWorkOutput {
    transactionId: string;
    state: string;
    deliverableHash: string;
    deliverableUri: string;
}

export async function handleSubmitWork(
    rawInput: unknown,
): Promise<Result<SubmitWorkOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    // Host the deliverable first — keccak256(content) is what goes
    // on-chain, so the hash provably matches what's stored.
    const { uri, hash } = await persistDeliverable(parse.data.deliverable);

    const callData = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "submit",
        args: [BigInt(parse.data.jobId), hash, "0x"],
    });
    const dispatch = await executeTier2Call({
        agent,
        to: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        data: callData,
    });
    if (!dispatch.ok) return err(dispatch.code, dispatch.message);
    return ok({
        transactionId: dispatch.transactionId,
        state: dispatch.state,
        deliverableHash: hash,
        deliverableUri: uri,
    });
}

registerTool({
    name: "arkage:submit_work",
    description:
        "Provider submits the job deliverable; ArkAge hosts it hash-addressed and commits the hash to ERC-8183",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            deliverable: {
                type: "string",
                description: "The work product content itself",
            },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "deliverable", "idempotencyKey"],
    },
    handler: handleSubmitWork,
});
