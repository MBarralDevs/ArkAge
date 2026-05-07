import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { findStuckWorkflows, reconcileStuckWorkflows } from "@/workers/reconcile-stuck-workflows";

// Plan B reconciler queries chain state via readJob and fires resumeHook.
// Stub both at the module boundary so the test is hermetic — no live RPC,
// no live workflow runtime needed.
vi.mock("@/lib/erc8183-state", () => ({
    readJob: vi.fn(async () => ({
        client: "0x1111111111111111111111111111111111111111",
        provider: "0x2222222222222222222222222222222222222222",
        evaluator: "0x3333333333333333333333333333333333333333",
        budget: 1_000_000n,
        expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        status: "Funded" as const,
        reason: "0x" + "00".repeat(32),
        hook: "0x4444444444444444444444444444444444444444",
    })),
    isTerminalState: () => false,
}));

vi.mock("workflow/api", () => ({
    resumeHook: vi.fn(async () => undefined),
}));

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

    it("fires the right hook + writes one audit_log row per stuck job_lifecycle", async () => {
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
        // Mocked readJob returns "Funded" so every stuck job_lifecycle
        // should fire JobFunded.
        const fired = result.results.filter(
            (r) => r.outcome === "fired_funded",
        );
        expect(fired.length).toBeGreaterThanOrEqual(2);

        const rows = await db.auditLog.findMany({
            where: {
                actorId: "stuck-workflow-reconciler",
                targetId: { in: ["test-stuck-recon-1", "test-stuck-recon-2"] },
            },
        });
        expect(rows.length).toBe(2);
        expect(rows.every((r) => r.action === "reconcile.fired_funded")).toBe(true);
    });
});
