import { db } from "@/lib/db";

export interface StuckWorkflow {
    runId: string;
    kind: string;
    kindId: bigint;
    lastAdvancedAt: Date;
}

/**
 * Find workflow_run rows that haven't advanced in `olderThanMinutes` and
 * are still in the `running` state. Capped at 100 per scan so a long
 * outage doesn't produce a multi-thousand-row report.
 */
export async function findStuckWorkflows(opts: {
    olderThanMinutes: number;
}): Promise<StuckWorkflow[]> {
    const threshold = new Date(Date.now() - opts.olderThanMinutes * 60 * 1000);
    const rows = await db.workflowRun.findMany({
        where: {
            status: "running",
            lastAdvancedAt: { lt: threshold },
        },
        select: { runId: true, kind: true, kindId: true, lastAdvancedAt: true },
        take: 100,
    });
    return rows;
}

/**
 * Plan A reconcile loop: detects stuck runs and writes one audit_log row
 * per detection. Plan B will branch off this worker to query chain state
 * via viem and synthesize the resumeHook the workflow is waiting on.
 */
export async function reconcileStuckWorkflows(): Promise<{ scanned: number; advanced: number }> {
    const stuck = await findStuckWorkflows({ olderThanMinutes: 10 });

    let advanced = 0;
    for (const run of stuck) {
        await db.auditLog.create({
            data: {
                actorKind: "system",
                actorId: "stuck-workflow-reconciler",
                action: "stuck_detected",
                targetKind: "workflow_run",
                targetId: run.runId,
                payloadJsonb: { kind: run.kind, kindId: String(run.kindId) },
            },
        });
        advanced++;
    }

    return { scanned: stuck.length, advanced };
}
