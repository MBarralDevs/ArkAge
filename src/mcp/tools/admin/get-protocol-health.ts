import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:get_protocol_health — protocol-wide stats snapshot for
 * dashboards and external monitoring.
 *
 * `stuckWorkflows` matches the cron's threshold (lastAdvancedAt > 10
 * min). Indexer cursors return `lastBlock` as a string for safe JSON
 * serialization.
 */

interface ProtocolHealthOutput {
    jobsByStatus: Record<string, number>;
    activeAgents: number;
    stuckWorkflows: number;
    indexerCursors: Array<{ source: string; lastBlock: string }>;
}

export async function handleGetProtocolHealth(): Promise<Result<ProtocolHealthOutput>> {
    const jobs = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
    const activeAgents = await db.agent.count({ where: { active: true } });
    const stuckThreshold = new Date(Date.now() - 10 * 60_000);
    const stuck = await db.workflowRun.count({
        where: { status: "running", lastAdvancedAt: { lt: stuckThreshold } },
    });
    const cursors = await db.indexerCursor.findMany({
        select: { source: true, lastBlock: true },
    });

    return ok({
        jobsByStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
        activeAgents,
        stuckWorkflows: stuck,
        indexerCursors: cursors.map((c) => ({
            source: c.source,
            lastBlock: c.lastBlock.toString(),
        })),
    });
}

registerTool({
    name: "arkage:get_protocol_health",
    description: "Protocol-wide health snapshot (jobs by status, active agents, stuck workflows, indexer cursors)",
    inputSchema: { type: "object", properties: {} },
    handler: handleGetProtocolHealth,
});
