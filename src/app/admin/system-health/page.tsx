import { db } from "@/lib/db";
import { publicClient } from "@/lib/chain";
import { HealthGrid } from "@/components/admin/health-grid";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
    const [stuckCount, runningCount, cursors, head] = await Promise.all([
        db.workflowRun.count({
            where: {
                status: "running",
                lastAdvancedAt: { lt: new Date(Date.now() - 10 * 60_000) },
            },
        }),
        db.workflowRun.count({ where: { status: "running" } }),
        db.indexerCursor.findMany(),
        publicClient.getBlockNumber(),
    ]);

    const maxLag = cursors.reduce((m, c) => {
        const lag = head - BigInt(c.lastBlock.toString());
        return lag > m ? lag : m;
    }, 0n);

    const stats = [
        {
            label: "Running workflows",
            value: runningCount.toLocaleString(),
            tone: "ok" as const,
        },
        {
            label: "Stuck workflows",
            value: stuckCount.toLocaleString(),
            tone: stuckCount > 0 ? ("warn" as const) : ("ok" as const),
        },
        {
            label: "Indexer max lag (blocks)",
            value: maxLag.toString(),
            tone: maxLag > 100n ? ("alert" as const) : ("ok" as const),
        },
        { label: "Chain head", value: head.toString() },
    ];

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">System health</h2>
            <HealthGrid stats={stats} />
        </div>
    );
}
