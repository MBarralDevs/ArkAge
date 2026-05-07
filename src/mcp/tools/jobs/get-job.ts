import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:get_job — read full job state from the materialized Postgres
 * view (populated by Goldsky pipeline + Circle webhook receiver).
 *
 * Returns counts of events + evaluations rather than the rows
 * themselves; clients that need detail should hit list-events /
 * list-evaluations tools (Plan C dashboard adds those views).
 */

const Input = z.object({ jobId: z.string().regex(/^[0-9]+$/) });

interface GetJobOutput {
    jobId: string;
    status: string;
    budget: string | null;
    evaluatorFee: string | null;
    evaluatorTier: string | null;
    expiredAt: string;
    clientAgentId: string;
    providerAgentId: string | null;
    reasonHash: string | null;
    eventCount: number;
    evaluationCount: number;
}

export async function handleGetJob(rawInput: unknown): Promise<Result<GetJobOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const job = await db.job.findUnique({
        where: { jobId: parse.data.jobId },
        include: {
            events: { orderBy: { blockTime: "asc" } },
            evaluations: true,
            clientAgent: { select: { agentId: true } },
            providerAgent: { select: { agentId: true } },
        },
    });
    if (!job) return err("not_found", `job ${parse.data.jobId} not found`);

    return ok({
        jobId: job.jobId.toString(),
        status: job.status,
        budget: job.budget?.toString() ?? null,
        evaluatorFee: job.evaluatorFee?.toString() ?? null,
        evaluatorTier: job.evaluatorTier,
        expiredAt: job.expiredAt.toISOString(),
        clientAgentId: job.clientAgent.agentId.toString(),
        providerAgentId: job.providerAgent?.agentId.toString() ?? null,
        reasonHash: job.reasonHash
            ? "0x" + Buffer.from(job.reasonHash).toString("hex")
            : null,
        eventCount: job.events.length,
        evaluationCount: job.evaluations.length,
    });
}

registerTool({
    name: "arkage:get_job",
    description: "Read full job state from the materialized Postgres view",
    inputSchema: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
    },
    handler: handleGetJob,
});
