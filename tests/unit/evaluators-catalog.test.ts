import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    job: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/env", () => ({
    env: {
        ARKAGE_VALIDATOR_WALLET_ADDRESS:
            "0x1111111111111111111111111111111111111111",
    },
}));

const { loadEvaluatorMarketplace, rawUsdcToUsd } = await import(
    "@/lib/evaluators-catalog"
);

const ARKAGE_VALIDATOR = "0x1111111111111111111111111111111111111111";
const BYO_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BYO_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function jobRow(opts: {
    id: bigint;
    status: string;
    evaluatorAddress: string;
    evaluatorTier: string | null;
    evaluatorFee?: bigint | null;
    clientAgentId: bigint;
    providerAgentId?: bigint | null;
    createdAt?: Date;
    updatedAt?: Date;
}) {
    return {
        id: opts.id,
        status: opts.status,
        evaluatorAddress: Buffer.from(opts.evaluatorAddress.slice(2), "hex"),
        evaluatorTier: opts.evaluatorTier,
        evaluatorFee:
            opts.evaluatorFee === undefined || opts.evaluatorFee === null
                ? null
                : { toString: () => opts.evaluatorFee!.toString() },
        clientAgentId: opts.clientAgentId,
        providerAgentId: opts.providerAgentId ?? null,
        createdAt: opts.createdAt ?? new Date("2026-05-14T10:00:00Z"),
        updatedAt: opts.updatedAt ?? new Date("2026-05-14T10:05:00Z"),
    };
}

describe("loadEvaluatorMarketplace", () => {
    beforeEach(() => dbMock.job.findMany.mockReset());

    it("returns empty list when no jobs exist", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([]);
        const result = await loadEvaluatorMarketplace();
        expect(result).toEqual([]);
    });

    it("groups by (address, tier) — ArkAge tiers stay separate", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "premium",
                clientAgentId: 10n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "standard",
                clientAgentId: 11n,
            }),
            jobRow({
                id: 3n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "premium",
                clientAgentId: 12n,
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        expect(result).toHaveLength(2);

        const premium = result.find((e) => e.key === "arkage:premium");
        const standard = result.find((e) => e.key === "arkage:standard");
        expect(premium?.jobsEvaluated).toBe(2);
        expect(standard?.jobsEvaluated).toBe(1);
    });

    it("sorts ArkAge before BYO, then premium → standard → fast", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 10n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "fast",
                clientAgentId: 10n,
            }),
            jobRow({
                id: 3n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "premium",
                clientAgentId: 10n,
            }),
            jobRow({
                id: 4n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "standard",
                clientAgentId: 10n,
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        const keys = result.map((r) => r.key);
        expect(keys).toEqual([
            "arkage:premium",
            "arkage:standard",
            "arkage:fast",
            `byo:${BYO_A}`,
        ]);
    });

    it("computes completion rate ignoring open/funded jobs", async () => {
        // 2 completed, 1 rejected, 1 expired, 1 still funded.
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 1n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 2n,
            }),
            jobRow({
                id: 3n,
                status: "rejected",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 3n,
            }),
            jobRow({
                id: 4n,
                status: "expired",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 4n,
            }),
            jobRow({
                id: 5n,
                status: "funded",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 5n,
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        const byo = result[0]!;
        expect(byo.jobsEvaluated).toBe(5);
        expect(byo.completed).toBe(2);
        expect(byo.rejected).toBe(1);
        expect(byo.expired).toBe(1);
        // 2 completed / (2 + 1 + 1) finalized = 50%
        expect(byo.completionRate).toBeCloseTo(0.5, 5);
    });

    it("sums total fees earned across all evaluated jobs", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                evaluatorFee: 1_000_000n,
                clientAgentId: 1n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                evaluatorFee: 2_500_000n,
                clientAgentId: 2n,
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        expect(result[0]!.totalFeesEarnedRaw).toBe("3500000");
    });

    it("computes unique client + provider counts", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 1n,
                providerAgentId: 100n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 1n, // repeat client
                providerAgentId: 101n,
            }),
            jobRow({
                id: 3n,
                status: "rejected",
                evaluatorAddress: BYO_A,
                evaluatorTier: null,
                clientAgentId: 2n,
                providerAgentId: null, // unfunded → no provider
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        expect(result[0]!.uniqueClients).toBe(2);
        expect(result[0]!.uniqueProviders).toBe(2);
    });

    it("displays distinct names for arkage tiers vs BYO addresses", async () => {
        dbMock.job.findMany.mockResolvedValueOnce([
            jobRow({
                id: 1n,
                status: "completed",
                evaluatorAddress: ARKAGE_VALIDATOR,
                evaluatorTier: "premium",
                clientAgentId: 1n,
            }),
            jobRow({
                id: 2n,
                status: "completed",
                evaluatorAddress: BYO_B,
                evaluatorTier: null,
                clientAgentId: 2n,
            }),
        ]);

        const result = await loadEvaluatorMarketplace();
        const arkage = result.find((e) => e.kind === "arkage-builtin");
        const byo = result.find((e) => e.kind === "byo");
        expect(arkage?.displayName).toMatch(/ArkAge Premium/);
        expect(byo?.displayName).toMatch(/BYO evaluator 0xbbbb/);
    });
});

describe("rawUsdcToUsd", () => {
    it("formats whole + fractional USDC at 6 decimals", () => {
        expect(rawUsdcToUsd("1000000")).toBe("1.0");
        expect(rawUsdcToUsd("1500000")).toBe("1.5");
        expect(rawUsdcToUsd("123456")).toBe("0.123456");
        expect(rawUsdcToUsd("0")).toBe("0.0");
    });
});
