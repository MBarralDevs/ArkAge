import { db } from "@/lib/db";
import { EvaluatorQueueTable } from "@/components/admin/evaluator-queue-table";

export const dynamic = "force-dynamic";

export default async function EvaluatorQueuePage() {
    const runs = await db.workflowRun.findMany({
        where: { kind: "evaluator" },
        orderBy: { startedAt: "desc" },
        take: 100,
    });
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">Evaluator queue</h2>
            <EvaluatorQueueTable
                rows={runs.map((r) => ({
                    runId: r.runId,
                    jobId: r.kindId.toString(),
                    status: r.status,
                    startedAt: r.startedAt.toISOString(),
                    lastAdvancedAt: r.lastAdvancedAt.toISOString(),
                }))}
            />
        </div>
    );
}
