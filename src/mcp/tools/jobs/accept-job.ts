import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:accept_job — provider's off-chain "I'll take this job" signal.
 *
 * No on-chain action; the actual on-chain commit is `set_budget` (which
 * provider calls next). This tool exists so dashboards can render
 * "provider acknowledged" before the budget is set.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    jobId: z.string().regex(/^[0-9]+$/),
    idempotencyKey: z.string().min(1),
});

export async function handleAcceptJob(
    rawInput: unknown,
): Promise<Result<{ acknowledged: true }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    await db.auditLog.create({
        data: {
            actorKind: "agent",
            actorId: parse.data.asAgent,
            action: "accept_job",
            targetKind: "job",
            targetId: parse.data.jobId,
            payloadJsonb: { idempotencyKey: parse.data.idempotencyKey } as object,
        },
    });

    return ok({ acknowledged: true });
}

registerTool({
    name: "arkage:accept_job",
    description:
        "Provider signals intent to accept an Open job (off-chain ack; setBudget is the on-chain commit)",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            jobId: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "jobId", "idempotencyKey"],
    },
    handler: handleAcceptJob,
});
