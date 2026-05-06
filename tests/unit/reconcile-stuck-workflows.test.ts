import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { findStuckWorkflows, reconcileStuckWorkflows } from "@/workers/reconcile-stuck-workflows";

describe("findStuckWorkflows", () => {
    beforeEach(async () => {
        await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
    });

    afterEach(async () => {
        await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
    });

    it("returns runs whose last_advanced_at is older than threshold", async () => {
        const stale = new Date(Date.now() - 15 * 60 * 1000);
        const fresh = new Date();

        await db.workflowRun.createMany({
            data: [
                {
                    runId: "test-stuck-stale-1",
                    kind: "job_lifecycle",
                    kindId: 1n,
                    status: "running",
                    startedAt: stale,
                    lastAdvancedAt: stale,
                },
                {
                    runId: "test-stuck-fresh-1",
                    kind: "job_lifecycle",
                    kindId: 2n,
                    status: "running",
                    startedAt: fresh,
                    lastAdvancedAt: fresh,
                },
            ],
        });

        const stuck = await findStuckWorkflows({ olderThanMinutes: 10 });
        const ids = stuck.map((w) => w.runId);
        expect(ids).toContain("test-stuck-stale-1");
        expect(ids).not.toContain("test-stuck-fresh-1");
    });

    it("ignores non-running runs", async () => {
        const stale = new Date(Date.now() - 15 * 60 * 1000);
        await db.workflowRun.create({
            data: {
                runId: "test-stuck-completed-1",
                kind: "job_lifecycle",
                kindId: 3n,
                status: "completed",
                startedAt: stale,
                lastAdvancedAt: stale,
                completedAt: stale,
            },
        });

        const stuck = await findStuckWorkflows({ olderThanMinutes: 10 });
        const ids = stuck.map((w) => w.runId);
        expect(ids).not.toContain("test-stuck-completed-1");
    });
});

describe("reconcileStuckWorkflows", () => {
    beforeEach(async () => {
        await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
        await db.auditLog.deleteMany({ where: { actorId: "stuck-workflow-reconciler" } });
    });

    afterEach(async () => {
        await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
        await db.auditLog.deleteMany({ where: { actorId: "stuck-workflow-reconciler" } });
    });

    it("writes one audit_log row per stuck workflow and returns counts", async () => {
        const stale = new Date(Date.now() - 20 * 60 * 1000);
        await db.workflowRun.createMany({
            data: [
                {
                    runId: "test-stuck-recon-1",
                    kind: "job_lifecycle",
                    kindId: 100n,
                    status: "running",
                    startedAt: stale,
                    lastAdvancedAt: stale,
                },
                {
                    runId: "test-stuck-recon-2",
                    kind: "job_lifecycle",
                    kindId: 101n,
                    status: "running",
                    startedAt: stale,
                    lastAdvancedAt: stale,
                },
            ],
        });

        const result = await reconcileStuckWorkflows();
        expect(result.scanned).toBeGreaterThanOrEqual(2);
        expect(result.advanced).toBe(result.scanned);

        const rows = await db.auditLog.findMany({
            where: {
                actorId: "stuck-workflow-reconciler",
                targetId: { in: ["test-stuck-recon-1", "test-stuck-recon-2"] },
            },
        });
        expect(rows.length).toBe(2);
    });
});
