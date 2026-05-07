import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:query_jobs — flexible filter over jobs by client/provider
 * agent + budget range.
 *
 * Budget filters use Prisma's Decimal comparison with string inputs
 * (the column is Decimal(38,0)). Composite range filters AND the
 * gte/lte clauses on the same `budget` key.
 */

const Input = z.object({
    clientAgentId: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    providerAgentId: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    minBudget: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    maxBudget: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    limit: z.number().int().min(1).max(100).default(20),
});

interface QueryJobsOutput {
    jobs: Array<{ jobId: string; status: string; budget: string | null }>;
}

export async function handleQueryJobs(rawInput: unknown): Promise<Result<QueryJobsOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const where: Prisma.JobWhereInput = {};
    if (parse.data.clientAgentId) {
        const a = await db.agent.findUnique({ where: { agentId: parse.data.clientAgentId } });
        if (!a) return err("not_found", `client agent ${parse.data.clientAgentId} not found`);
        where.clientAgentId = a.id;
    }
    if (parse.data.providerAgentId) {
        const a = await db.agent.findUnique({
            where: { agentId: parse.data.providerAgentId },
        });
        if (!a) return err("not_found", `provider agent ${parse.data.providerAgentId} not found`);
        where.providerAgentId = a.id;
    }
    const budgetFilter: Prisma.DecimalFilter = {};
    if (parse.data.minBudget) budgetFilter.gte = parse.data.minBudget;
    if (parse.data.maxBudget) budgetFilter.lte = parse.data.maxBudget;
    if (Object.keys(budgetFilter).length > 0) where.budget = budgetFilter;

    const rows = await db.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parse.data.limit,
        select: { jobId: true, status: true, budget: true },
    });

    return ok({
        jobs: rows.map((r) => ({
            jobId: r.jobId.toString(),
            status: r.status,
            budget: r.budget?.toString() ?? null,
        })),
    });
}

registerTool({
    name: "arkage:query_jobs",
    description: "Filter jobs by client/provider agent and budget range",
    inputSchema: {
        type: "object",
        properties: {
            clientAgentId: { type: "string" },
            providerAgentId: { type: "string" },
            minBudget: { type: "string" },
            maxBudget: { type: "string" },
            limit: { type: "number" },
        },
    },
    handler: handleQueryJobs,
});
