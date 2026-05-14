import { db } from "./db";
import { env } from "./env";
import type { Address } from "viem";

/**
 * Plan E.4 — public evaluator marketplace surface.
 *
 * Aggregates every distinct evaluator that has been picked on a Job into
 * one ranked list. Rows are grouped by (evaluatorAddress, evaluatorTier)
 * so ArkAge's three built-in tiers (fast/standard/premium) appear as
 * three separate listings even though they share a single validator
 * wallet — what builders pick at `post_job` time is a tier, not an
 * address, so the marketplace should match that mental model.
 *
 * BYO evaluators (anyone with an address ≠ ArkAge's validator and
 * `evaluatorTier IS NULL`) appear as one row per address.
 */

export type EvaluatorTier = "fast" | "standard" | "premium";

export interface EvaluatorListing {
    /** Stable composite key — `arkage:<tier>` or `byo:<lowercased-address>`. */
    key: string;
    kind: "arkage-builtin" | "byo";
    address: Address;
    tier: EvaluatorTier | null;
    displayName: string;
    jobsEvaluated: number;
    completed: number;
    rejected: number;
    expired: number;
    /** Share of evaluated jobs that ended in `completed` (0..1). */
    completionRate: number;
    /** Average wall-clock between createdAt and completedAtBlock-recorded
     *  (we don't have completedAt; use updatedAt of completed jobs as a
     *  proxy — Job.updatedAt advances on status writes). Null when no
     *  completed jobs yet. */
    averageDecisionMs: number | null;
    totalFeesEarnedRaw: string;
    uniqueClients: number;
    uniqueProviders: number;
}

export interface EvaluatorDetail extends EvaluatorListing {
    recentJobs: Array<{
        jobId: string;
        status: string;
        budget: string | null;
        clientAgentId: string;
        providerAgentId: string | null;
        createdAt: string;
        updatedAt: string;
    }>;
}

const RECENT_LIMIT = 25;

function arkageValidatorAddress(): Address | null {
    const raw = env.ARKAGE_VALIDATOR_WALLET_ADDRESS;
    return raw ? (raw.toLowerCase() as Address) : null;
}

function isoToMs(d: Date): number {
    return d.getTime();
}

function bytesToAddress(b: Buffer | Uint8Array): Address {
    return ("0x" + Buffer.from(b).toString("hex")) as Address;
}

function displayNameFor(
    kind: "arkage-builtin" | "byo",
    tier: EvaluatorTier | null,
    address: Address,
): string {
    if (kind === "arkage-builtin" && tier) {
        const human =
            tier === "premium"
                ? "ArkAge Premium (Claude Opus)"
                : tier === "standard"
                  ? "ArkAge Standard (Claude Sonnet)"
                  : "ArkAge Fast (Claude Haiku)";
        return human;
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    return `BYO evaluator ${short}`;
}

/**
 * Returns all evaluators sorted: ArkAge built-in first (premium → standard →
 * fast), then BYO by jobs-evaluated desc.
 */
export async function loadEvaluatorMarketplace(): Promise<EvaluatorListing[]> {
    const arkage = arkageValidatorAddress();

    // One bulk fetch; bucketing happens in JS. The job table is small
    // enough on testnet that this is cheaper than per-evaluator queries.
    const jobs = await db.job.findMany({
        select: {
            id: true,
            status: true,
            evaluatorAddress: true,
            evaluatorTier: true,
            evaluatorFee: true,
            clientAgentId: true,
            providerAgentId: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    type BucketAcc = {
        address: Address;
        tier: EvaluatorTier | null;
        jobsEvaluated: number;
        completed: number;
        rejected: number;
        expired: number;
        durationsMs: number[];
        feeSumRaw: bigint;
        clients: Set<string>;
        providers: Set<string>;
    };

    const buckets = new Map<string, BucketAcc>();

    for (const j of jobs) {
        const addr = bytesToAddress(j.evaluatorAddress).toLowerCase() as Address;
        const tier = j.evaluatorTier as EvaluatorTier | null;
        const isArkage = arkage !== null && addr === arkage;
        const key = isArkage && tier ? `arkage:${tier}` : `byo:${addr}`;

        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = {
                address: addr,
                tier,
                jobsEvaluated: 0,
                completed: 0,
                rejected: 0,
                expired: 0,
                durationsMs: [],
                feeSumRaw: 0n,
                clients: new Set(),
                providers: new Set(),
            };
            buckets.set(key, bucket);
        }

        bucket.jobsEvaluated += 1;
        if (j.status === "completed") bucket.completed += 1;
        else if (j.status === "rejected") bucket.rejected += 1;
        else if (j.status === "expired") bucket.expired += 1;
        if (j.status === "completed" || j.status === "rejected") {
            bucket.durationsMs.push(
                isoToMs(j.updatedAt) - isoToMs(j.createdAt),
            );
        }
        if (j.evaluatorFee !== null) {
            bucket.feeSumRaw += BigInt(j.evaluatorFee.toString());
        }
        bucket.clients.add(j.clientAgentId.toString());
        if (j.providerAgentId !== null) {
            bucket.providers.add(j.providerAgentId.toString());
        }
    }

    const listings: EvaluatorListing[] = Array.from(buckets.entries()).map(
        ([key, b]) => {
            const kind: "arkage-builtin" | "byo" = key.startsWith("arkage:")
                ? "arkage-builtin"
                : "byo";
            const avgDecisionMs =
                b.durationsMs.length === 0
                    ? null
                    : b.durationsMs.reduce((a, x) => a + x, 0) /
                      b.durationsMs.length;
            const finalized = b.completed + b.rejected + b.expired;
            return {
                key,
                kind,
                address: b.address,
                tier: b.tier,
                displayName: displayNameFor(kind, b.tier, b.address),
                jobsEvaluated: b.jobsEvaluated,
                completed: b.completed,
                rejected: b.rejected,
                expired: b.expired,
                completionRate:
                    finalized === 0 ? 0 : b.completed / finalized,
                averageDecisionMs: avgDecisionMs,
                totalFeesEarnedRaw: b.feeSumRaw.toString(),
                uniqueClients: b.clients.size,
                uniqueProviders: b.providers.size,
            };
        },
    );

    return listings.sort(sortMarketplace);
}

/** Detail view: same shape as a listing row + recent jobs the evaluator decided. */
export async function loadEvaluatorDetail(
    key: string,
): Promise<EvaluatorDetail | null> {
    const arkage = arkageValidatorAddress();
    const { address, tier } = parseKey(key, arkage);
    if (!address) return null;

    // Pull every job matching the (address, tier) tuple. Tier is the
    // disambiguator inside the ArkAge built-in cohort.
    const where: Parameters<typeof db.job.findMany>[0] = {
        where: {
            evaluatorAddress: Buffer.from(address.slice(2), "hex"),
            ...(tier !== null
                ? { evaluatorTier: tier }
                : { evaluatorTier: null }),
        },
    };

    const all = await loadEvaluatorMarketplace();
    const summary = all.find((l) => l.key === key);
    if (!summary) return null;

    const recent = await db.job.findMany({
        ...where,
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
            jobId: true,
            status: true,
            budget: true,
            clientAgent: { select: { agentId: true } },
            providerAgent: { select: { agentId: true } },
            createdAt: true,
            updatedAt: true,
        },
    });

    return {
        ...summary,
        recentJobs: recent.map((j) => ({
            jobId: j.jobId.toString(),
            status: j.status,
            budget: j.budget?.toString() ?? null,
            clientAgentId: j.clientAgent.agentId.toString(),
            providerAgentId: j.providerAgent?.agentId?.toString() ?? null,
            createdAt: j.createdAt.toISOString(),
            updatedAt: j.updatedAt.toISOString(),
        })),
    };
}

function parseKey(
    key: string,
    arkage: Address | null,
): { address: Address | null; tier: EvaluatorTier | null } {
    if (key.startsWith("arkage:")) {
        const tier = key.slice("arkage:".length) as EvaluatorTier;
        if (!["fast", "standard", "premium"].includes(tier)) {
            return { address: null, tier: null };
        }
        return { address: arkage, tier };
    }
    if (key.startsWith("byo:")) {
        const addr = key.slice("byo:".length).toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(addr)) {
            return { address: null, tier: null };
        }
        return { address: addr as Address, tier: null };
    }
    return { address: null, tier: null };
}

function sortMarketplace(a: EvaluatorListing, b: EvaluatorListing): number {
    // ArkAge built-in first, ordered premium → standard → fast.
    const tierPriority: Record<string, number> = {
        premium: 0,
        standard: 1,
        fast: 2,
    };
    if (a.kind === "arkage-builtin" && b.kind === "arkage-builtin") {
        return (
            (tierPriority[a.tier ?? "fast"] ?? 99) -
            (tierPriority[b.tier ?? "fast"] ?? 99)
        );
    }
    if (a.kind === "arkage-builtin") return -1;
    if (b.kind === "arkage-builtin") return 1;
    // Within BYO: most active first.
    return b.jobsEvaluated - a.jobsEvaluated;
}

export function rawUsdcToUsd(raw: string): string {
    const big = BigInt(raw);
    const whole = big / 1_000_000n;
    const fracStr =
        (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") ||
        "0";
    return `${whole}.${fracStr}`;
}
