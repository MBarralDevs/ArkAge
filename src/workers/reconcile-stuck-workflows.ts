import { db } from "@/lib/db";
import { resumeHook } from "workflow/api";
import {
    readJob,
    isTerminalState,
    type JobStatusEnum,
} from "@/lib/erc8183-state";
import {
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
} from "@/workflows/lib/hook-tokens";

/**
 * Stuck-workflow reconciler — Plan B closes the loop on the Plan A scaffold.
 *
 * For every workflow_run row that hasn't advanced in 10 minutes we read
 * the chain state via viem and fire the deterministic hook token the
 * workflow is parked on. resumeHook is idempotent on (token, payload),
 * so re-firing a token whose hook already received a payload is a no-op.
 *
 * One audit_log row per detection records the outcome — `fired_funded`,
 * `fired_submitted`, `fired_terminal`, `no_advancement_possible`,
 * `skipped_unknown_kind`, or `error`. Mirrors the cron's return shape
 * for /admin/cron-runs (Plan C consumer).
 */

export interface StuckWorkflow {
    runId: string;
    kind: string;
    kindId: bigint;
    lastAdvancedAt: Date;
}

export async function findStuckWorkflows(opts: {
    olderThanMinutes: number;
}): Promise<StuckWorkflow[]> {
    const threshold = new Date(Date.now() - opts.olderThanMinutes * 60 * 1000);
    return db.workflowRun.findMany({
        where: { status: "running", lastAdvancedAt: { lt: threshold } },
        select: { runId: true, kind: true, kindId: true, lastAdvancedAt: true },
        take: 100,
    });
}

interface RescueResult {
    runId: string;
    kind: string;
    outcome:
        | "fired_funded"
        | "fired_submitted"
        | "fired_terminal"
        | "no_advancement_possible"
        | "skipped_unknown_kind"
        | "error";
    detail?: string;
}

async function rescueJobLifecycle(run: StuckWorkflow): Promise<RescueResult> {
    try {
        const state: JobStatusEnum = (await readJob(run.kindId)).status;

        if (state === "Funded") {
            await resumeHook(jobFundedToken(run.kindId), {
                jobId: run.kindId.toString(),
            });
            return { runId: run.runId, kind: run.kind, outcome: "fired_funded" };
        }
        if (state === "Submitted") {
            await resumeHook(jobSubmittedToken(run.kindId), {
                jobId: run.kindId.toString(),
                deliverable: "0x" + "00".repeat(32),
            });
            return {
                runId: run.runId,
                kind: run.kind,
                outcome: "fired_submitted",
            };
        }
        if (isTerminalState(state)) {
            await resumeHook(jobTerminalToken(run.kindId), { status: state });
            return {
                runId: run.runId,
                kind: run.kind,
                outcome: "fired_terminal",
            };
        }
        return {
            runId: run.runId,
            kind: run.kind,
            outcome: "no_advancement_possible",
            detail: state,
        };
    } catch (e) {
        return {
            runId: run.runId,
            kind: run.kind,
            outcome: "error",
            detail: e instanceof Error ? e.message : String(e),
        };
    }
}

export async function reconcileStuckWorkflows(): Promise<{
    scanned: number;
    results: RescueResult[];
}> {
    const stuck = await findStuckWorkflows({ olderThanMinutes: 10 });

    const results: RescueResult[] = [];
    for (const run of stuck) {
        let result: RescueResult;
        if (run.kind === "job_lifecycle") {
            result = await rescueJobLifecycle(run);
        } else {
            // evaluator / x402_session / dispute don't sit on a single
            // chain-state poll, so the reconciler can't synthesize their
            // hook firing. They surface in audit_log for /admin/disputes
            // (Plan C) to handle manually.
            result = {
                runId: run.runId,
                kind: run.kind,
                outcome: "skipped_unknown_kind",
            };
        }
        results.push(result);

        await db.auditLog.create({
            data: {
                actorKind: "system",
                actorId: "stuck-workflow-reconciler",
                action: `reconcile.${result.outcome}`,
                targetKind: "workflow_run",
                targetId: run.runId,
                payloadJsonb: {
                    kind: run.kind,
                    kindId: String(run.kindId),
                    detail: result.detail ?? null,
                } as object,
            },
        });
    }

    return { scanned: stuck.length, results };
}
