import { db } from "@/lib/db";
import { getWorkflowMetadata } from "workflow";

/**
 * Workflow Postgres bookkeeping steps.
 *
 * Every workflow uses these to maintain its `workflow_runs` row.
 * `lastAdvancedAt` is the field the stuck-workflow reconciler checks —
 * any workflow that hasn't advanced in 10 minutes gets a heartbeat
 * audit row (Plan A Task 31).
 *
 * All three are marked `"use step"` because they perform DB writes.
 */

export async function recordWorkflowStart(kind: string, kindId: bigint): Promise<void> {
    "use step";
    const meta = getWorkflowMetadata();
    const runId = meta.workflowRunId;
    console.log(`[workflow] start kind=${kind} kindId=${kindId} runId=${runId}`);
    const now = new Date();
    await db.workflowRun.upsert({
        where: { runId },
        update: { lastAdvancedAt: now },
        create: {
            runId,
            kind,
            kindId,
            status: "running",
            startedAt: now,
            lastAdvancedAt: now,
        },
    });
}

export async function recordWorkflowAdvance(label: string): Promise<void> {
    "use step";
    const meta = getWorkflowMetadata();
    const runId = meta.workflowRunId;
    console.log(`[workflow] advance runId=${runId} label=${label}`);
    await db.workflowRun.update({
        where: { runId },
        data: { lastAdvancedAt: new Date() },
    });
}

export async function recordWorkflowComplete(outcome: string): Promise<void> {
    "use step";
    const meta = getWorkflowMetadata();
    const runId = meta.workflowRunId;
    const now = new Date();
    console.log(`[workflow] complete runId=${runId} outcome=${outcome}`);
    await db.workflowRun.update({
        where: { runId },
        data: {
            status: "completed",
            completedAt: now,
            lastAdvancedAt: now,
            error: outcome,
        },
    });
}
