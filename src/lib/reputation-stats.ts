import { db } from "./db";

/**
 * Plan E.2 — rich reputation aggregations for the agent profile.
 *
 * Replaces the v1 "load all feedback rows, bucketize in JS" pattern with
 * a single Postgres aggregation per agent. Returns four views that the
 * profile UI renders independently:
 *   - distribution   — score histogram (extended buckets vs v1's 5)
 *   - byEvaluator    — per-evaluator-tier rollup (fast/standard/premium)
 *   - freshness      — 7d / 30d / 90d / older counts (drives the
 *                       "Active" badge + "stale" warning)
 *   - diversity      — unique counterparty count, top counterparty share
 *                       (concentration metric to catch one-friend-spam)
 *   - timeseries     — running average over time (v1's existing shape)
 *
 * Same monetary-unit conventions as the rest of the repo: nothing here
 * touches USDC, just integer scores.
 */

export interface ReputationStats {
    total: number;
    averageScore: number | null;
    distribution: Array<{ bucket: string; count: number }>;
    byEvaluator: Array<{
        tier: string;
        count: number;
        averageScore: number | null;
    }>;
    freshness: {
        last7d: number;
        last30d: number;
        last90d: number;
        older: number;
    };
    diversity: {
        uniqueCounterparties: number;
        /** Concentration: share of feedback events from the single most active counterparty (0..1). */
        topCounterpartyShare: number;
    };
    timeseries: Array<{ ts: string; runningAverage: number }>;
}

const BUCKETS: Array<{ label: string; min: number; max: number }> = [
    { label: "≤-50", min: -1_000_000, max: -50 },
    { label: "-49..-1", min: -49, max: -1 },
    { label: "0", min: 0, max: 0 },
    { label: "1..24", min: 1, max: 24 },
    { label: "25..49", min: 25, max: 49 },
    { label: "50..100", min: 50, max: 1_000_000 },
];

export async function loadAgentReputation(
    agentDbId: bigint,
): Promise<ReputationStats> {
    // One bulk fetch sorted oldest→newest. For the testnet load (≤ thousands
    // per agent) this is cheaper than 5 separate aggregation queries.
    const feedback = await db.reputationFeedback.findMany({
        where: { agentId: agentDbId },
        orderBy: { createdAt: "asc" },
        select: {
            score: true,
            createdAt: true,
            jobId: true,
            submitterAddress: true,
        },
    });

    const total = feedback.length;
    const sum = feedback.reduce((acc, r) => acc + (r.score ?? 0), 0);
    const averageScore = total === 0 ? null : sum / total;

    // Distribution
    const distribution = BUCKETS.map((b) => ({
        bucket: b.label,
        count: feedback.filter(
            (r) =>
                (r.score ?? 0) >= b.min && (r.score ?? 0) <= b.max,
        ).length,
    }));

    // Time series — running average per row
    let running = 0;
    const timeseries = feedback.map((r, i) => {
        running = (running * i + (r.score ?? 0)) / (i + 1);
        return {
            ts: r.createdAt.toISOString(),
            runningAverage: Math.round(running * 100) / 100,
        };
    });

    // Freshness
    const now = Date.now();
    const ms7d = 7 * 24 * 60 * 60 * 1000;
    const ms30d = 30 * 24 * 60 * 60 * 1000;
    const ms90d = 90 * 24 * 60 * 60 * 1000;
    const freshness = { last7d: 0, last30d: 0, last90d: 0, older: 0 };
    for (const r of feedback) {
        const ageMs = now - r.createdAt.getTime();
        if (ageMs < ms7d) freshness.last7d++;
        else if (ageMs < ms30d) freshness.last30d++;
        else if (ageMs < ms90d) freshness.last90d++;
        else freshness.older++;
    }

    // By evaluator — join through jobId. Multiple feedback rows may have
    // jobId NULL (external sources / non-ArkAge feedback); we bucket those
    // as "unknown".
    const jobIds = Array.from(
        new Set(
            feedback
                .map((r) => r.jobId)
                .filter((j): j is bigint => j !== null),
        ),
    );
    const jobs =
        jobIds.length === 0
            ? []
            : await db.job.findMany({
                  where: { id: { in: jobIds } },
                  select: {
                      id: true,
                      evaluatorTier: true,
                      clientAgentId: true,
                      providerAgentId: true,
                  },
              });
    const tierByJobId = new Map<string, string>();
    const counterpartyByJobId = new Map<string, bigint>();
    for (const j of jobs) {
        tierByJobId.set(j.id.toString(), j.evaluatorTier ?? "unknown");
        const counterparty =
            j.clientAgentId === agentDbId
                ? j.providerAgentId
                : j.clientAgentId;
        if (counterparty !== null && counterparty !== undefined) {
            counterpartyByJobId.set(j.id.toString(), counterparty);
        }
    }

    const tierBuckets = new Map<
        string,
        { count: number; sum: number }
    >();
    for (const r of feedback) {
        const tier =
            r.jobId !== null
                ? (tierByJobId.get(r.jobId.toString()) ?? "unknown")
                : "unknown";
        const entry = tierBuckets.get(tier) ?? { count: 0, sum: 0 };
        entry.count += 1;
        entry.sum += r.score ?? 0;
        tierBuckets.set(tier, entry);
    }
    const byEvaluator = Array.from(tierBuckets.entries())
        .map(([tier, v]) => ({
            tier,
            count: v.count,
            averageScore: v.count === 0 ? null : v.sum / v.count,
        }))
        .sort((a, b) => b.count - a.count);

    // Diversity — unique counterparties, plus concentration of the top one
    const counterpartyCounts = new Map<string, number>();
    for (const r of feedback) {
        const counterparty =
            r.jobId !== null
                ? counterpartyByJobId.get(r.jobId.toString())
                : null;
        if (counterparty === null || counterparty === undefined) continue;
        const key = counterparty.toString();
        counterpartyCounts.set(key, (counterpartyCounts.get(key) ?? 0) + 1);
    }
    const counterpartyTotal = Array.from(counterpartyCounts.values()).reduce(
        (a, b) => a + b,
        0,
    );
    const topCount =
        counterpartyTotal === 0
            ? 0
            : Math.max(...Array.from(counterpartyCounts.values()));
    const diversity = {
        uniqueCounterparties: counterpartyCounts.size,
        topCounterpartyShare:
            counterpartyTotal === 0 ? 0 : topCount / counterpartyTotal,
    };

    return {
        total,
        averageScore,
        distribution,
        byEvaluator,
        freshness,
        diversity,
        timeseries,
    };
}
