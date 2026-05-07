import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:list_jobs — paginated listing filtered by status. The default
 * order is most-recent-first.
 *
 * Returns `total` so callers can render counts without a second query.
 */

const Input = z.object({
    status: z
        .enum(["open", "funded", "submitted", "completed", "rejected", "expired"])
        .optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
});

interface ListJobsOutput {
    jobs: Array<{ jobId: string; status: string; budget: string | null; expiredAt: string }>;
    total: number;
}

export async function handleListJobs(rawInput: unknown): Promise<Result<ListJobsOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const where = parse.data.status ? { status: parse.data.status } : {};
    const [rows, total] = await Promise.all([
        db.job.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: parse.data.limit,
            skip: parse.data.offset,
            select: { jobId: true, status: true, budget: true, expiredAt: true },
        }),
        db.job.count({ where }),
    ]);

    return ok({
        jobs: rows.map((r) => ({
            jobId: r.jobId.toString(),
            status: r.status,
            budget: r.budget?.toString() ?? null,
            expiredAt: r.expiredAt.toISOString(),
        })),
        total,
    });
}

registerTool({
    name: "arkage:list_jobs",
    description: "Paginated list of jobs filtered by status",
    inputSchema: {
        type: "object",
        properties: {
            status: { type: "string" },
            limit: { type: "number" },
            offset: { type: "number" },
        },
    },
    handler: handleListJobs,
});
