import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:query_reputation_history — paginated feedback entries for an
 * agent ordered most-recent-first. Used by dashboard and external
 * audit consumers.
 */

const Input = z.object({
    agentId: z.string().regex(/^[0-9]+$/),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
});

interface ReputationEntry {
    score: number | null;
    tag1: string | null;
    tag2: string | null;
    source: string;
    jobId: string | null;
    blockTime: string;
    txHash: string;
}

export async function handleQueryReputationHistory(
    rawInput: unknown,
): Promise<Result<{ entries: ReputationEntry[] }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
    if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

    const rows = await db.reputationFeedback.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: parse.data.limit,
        skip: parse.data.offset,
    });

    return ok({
        entries: rows.map((r) => ({
            score: r.score,
            tag1: r.tag1,
            tag2: r.tag2,
            source: r.source,
            jobId: r.jobId?.toString() ?? null,
            blockTime: r.blockTime.toISOString(),
            txHash: "0x" + Buffer.from(r.txHash).toString("hex"),
        })),
    });
}

registerTool({
    name: "arkage:query_reputation_history",
    description: "Paginated list of reputation feedback entries for an agent",
    inputSchema: {
        type: "object",
        properties: {
            agentId: { type: "string" },
            limit: { type: "number" },
            offset: { type: "number" },
        },
        required: ["agentId"],
    },
    handler: handleQueryReputationHistory,
});
