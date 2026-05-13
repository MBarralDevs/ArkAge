import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    reputationFeedback: { findMany: vi.fn() },
    job: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { loadAgentReputation } = await import("@/lib/reputation-stats");

const AGENT_ID = 100n;

function feedbackRow(
    score: number,
    daysAgo: number,
    jobId: bigint | null = null,
) {
    return {
        score,
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        jobId,
        submitterAddress: Buffer.from("aa".repeat(20), "hex"),
    };
}

function jobRow(
    id: bigint,
    tier: string | null,
    client: bigint,
    provider: bigint | null,
) {
    return {
        id,
        evaluatorTier: tier,
        clientAgentId: client,
        providerAgentId: provider,
    };
}

describe("loadAgentReputation", () => {
    beforeEach(() => {
        dbMock.reputationFeedback.findMany.mockReset();
        dbMock.job.findMany.mockReset();
    });

    it("returns empty shape when no feedback exists", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([]);

        const stats = await loadAgentReputation(AGENT_ID);

        expect(stats.total).toBe(0);
        expect(stats.averageScore).toBeNull();
        expect(stats.distribution.every((b) => b.count === 0)).toBe(true);
        expect(stats.byEvaluator).toEqual([]);
        expect(stats.freshness).toEqual({
            last7d: 0,
            last30d: 0,
            last90d: 0,
            older: 0,
        });
        expect(stats.diversity).toEqual({
            uniqueCounterparties: 0,
            topCounterpartyShare: 0,
        });
        expect(stats.timeseries).toEqual([]);
    });

    it("bucketizes scores into the extended 6-bucket distribution", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(-60, 5),
            feedbackRow(-10, 5),
            feedbackRow(0, 5),
            feedbackRow(15, 5),
            feedbackRow(40, 5),
            feedbackRow(80, 5),
        ]);
        dbMock.job.findMany.mockResolvedValueOnce([]);

        const stats = await loadAgentReputation(AGENT_ID);

        const labels = stats.distribution.map((d) => d.bucket);
        expect(labels).toEqual([
            "≤-50",
            "-49..-1",
            "0",
            "1..24",
            "25..49",
            "50..100",
        ]);
        for (const b of stats.distribution) {
            expect(b.count).toBe(1);
        }
    });

    it("groups freshness by 7d / 30d / 90d windows", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(50, 1),
            feedbackRow(50, 15),
            feedbackRow(50, 60),
            feedbackRow(50, 200),
        ]);
        dbMock.job.findMany.mockResolvedValueOnce([]);

        const stats = await loadAgentReputation(AGENT_ID);

        expect(stats.freshness).toEqual({
            last7d: 1,
            last30d: 1,
            last90d: 1,
            older: 1,
        });
    });

    it("rolls up feedback by evaluator tier (joining via jobId)", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(80, 1, 1n),
            feedbackRow(60, 1, 2n),
            feedbackRow(40, 1, 3n),
            feedbackRow(90, 1, null), // jobId null → "unknown"
        ]);
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow(1n, "premium", 5n, AGENT_ID),
            jobRow(2n, "premium", 6n, AGENT_ID),
            jobRow(3n, "standard", 7n, AGENT_ID),
        ]);

        const stats = await loadAgentReputation(AGENT_ID);

        const tiers = stats.byEvaluator.map((r) => r.tier);
        expect(tiers).toEqual(["premium", "standard", "unknown"]);

        const premium = stats.byEvaluator.find((r) => r.tier === "premium");
        expect(premium?.count).toBe(2);
        expect(premium?.averageScore).toBe(70);

        const standard = stats.byEvaluator.find((r) => r.tier === "standard");
        expect(standard?.count).toBe(1);

        const unknown = stats.byEvaluator.find((r) => r.tier === "unknown");
        expect(unknown?.count).toBe(1);
    });

    it("computes diversity from unique counterparties", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(50, 1, 1n),
            feedbackRow(50, 1, 2n),
            feedbackRow(50, 1, 3n),
            feedbackRow(50, 1, 4n),
            feedbackRow(50, 1, 5n),
        ]);
        // All 5 feedback events come from 5 distinct counterparties (agent is
        // the provider, counterparty is the client).
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow(1n, "standard", 10n, AGENT_ID),
            jobRow(2n, "standard", 11n, AGENT_ID),
            jobRow(3n, "standard", 12n, AGENT_ID),
            jobRow(4n, "standard", 13n, AGENT_ID),
            jobRow(5n, "standard", 14n, AGENT_ID),
        ]);

        const stats = await loadAgentReputation(AGENT_ID);

        expect(stats.diversity.uniqueCounterparties).toBe(5);
        expect(stats.diversity.topCounterpartyShare).toBeCloseTo(0.2, 5);
    });

    it("flags concentration when a single counterparty dominates", async () => {
        // 4 events from agent 10, 1 from agent 11 → top share = 0.8
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(50, 1, 1n),
            feedbackRow(50, 1, 2n),
            feedbackRow(50, 1, 3n),
            feedbackRow(50, 1, 4n),
            feedbackRow(50, 1, 5n),
        ]);
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow(1n, "standard", 10n, AGENT_ID),
            jobRow(2n, "standard", 10n, AGENT_ID),
            jobRow(3n, "standard", 10n, AGENT_ID),
            jobRow(4n, "standard", 10n, AGENT_ID),
            jobRow(5n, "standard", 11n, AGENT_ID),
        ]);

        const stats = await loadAgentReputation(AGENT_ID);

        expect(stats.diversity.uniqueCounterparties).toBe(2);
        expect(stats.diversity.topCounterpartyShare).toBeCloseTo(0.8, 5);
    });

    it("produces a running-average time series", async () => {
        dbMock.reputationFeedback.findMany.mockResolvedValueOnce([
            feedbackRow(10, 30),
            feedbackRow(20, 20),
            feedbackRow(30, 10),
        ]);
        dbMock.job.findMany.mockResolvedValueOnce([]);

        const stats = await loadAgentReputation(AGENT_ID);

        expect(stats.timeseries.map((t) => t.runningAverage)).toEqual([
            10, 15, 20,
        ]);
    });
});
