import { describe, it, expect } from "vitest";
import { evaluatePolicy, type PolicyCheckRequest } from "@/lib/policy-engine";
import type { AgentPolicy } from "@/lib/policy-canonical";

const POLICY: AgentPolicy = {
    schemaVersion: 1,
    agentId: "100",
    version: 1,
    validFrom: 0,
    validTo: null,
    spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
    allowedContracts: ["0x0747eef0706327138c69792bf28cd525089e4583"],
    allowedSelectors: [],
    counterpartyRules: {
        minReputation: null,
        allowList: [],
        denyList: ["0xdead000000000000000000000000000000000000"],
    },
    rateLimits: { jobsPerHour: 5, x402CallsPerMinute: 50 },
    tokens: [],
    evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
};

const baseReq: Omit<PolicyCheckRequest, "policy"> = {
    agentDbId: 1n,
    action: "fund_job",
    amount: 500_000n,
    counterparty: "0xaaaa000000000000000000000000000000000001",
    contractTarget: "0x0747eef0706327138c69792bf28cd525089e4583",
};

describe("evaluatePolicy", () => {
    it("approves when within all caps + allowlist", async () => {
        const verdict = await evaluatePolicy({ ...baseReq, policy: POLICY });
        expect(verdict.ok).toBe(true);
    });

    it("rejects amount over perTx cap", async () => {
        const verdict = await evaluatePolicy({
            ...baseReq,
            amount: 2_000_000n,
            policy: POLICY,
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.code).toBe("policy:per_tx_cap");
    });

    it("approves exact-cap amount (boundary)", async () => {
        const verdict = await evaluatePolicy({
            ...baseReq,
            amount: 1_000_000n,
            policy: POLICY,
        });
        expect(verdict.ok).toBe(true);
    });

    it("rejects contract not in allowlist", async () => {
        const verdict = await evaluatePolicy({
            ...baseReq,
            contractTarget: "0xbbbb000000000000000000000000000000000001",
            policy: POLICY,
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.code).toBe("policy:contract_not_allowed");
    });

    it("rejects denied counterparty (case-insensitive)", async () => {
        const verdict = await evaluatePolicy({
            ...baseReq,
            counterparty: "0xDEAD000000000000000000000000000000000000",
            policy: POLICY,
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.code).toBe("policy:counterparty_denied");
    });

    it("rejects when policy validTo has passed", async () => {
        const expired: AgentPolicy = {
            ...POLICY,
            validTo: Math.floor(Date.now() / 1000) - 60,
        };
        const verdict = await evaluatePolicy({ ...baseReq, policy: expired });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.code).toBe("policy:expired");
    });

    it("approves when allowlist is empty (no contract restriction)", async () => {
        const open: AgentPolicy = { ...POLICY, allowedContracts: [] };
        const verdict = await evaluatePolicy({
            ...baseReq,
            contractTarget: "0xbbbb000000000000000000000000000000000001",
            policy: open,
        });
        expect(verdict.ok).toBe(true);
    });

    it("rejects when counterparty allowlist is set and counterparty is missing", async () => {
        const allowOnly: AgentPolicy = {
            ...POLICY,
            counterpartyRules: {
                minReputation: null,
                allowList: ["0xfeed000000000000000000000000000000000000"],
                denyList: [],
            },
        };
        const verdict = await evaluatePolicy({
            ...baseReq,
            counterparty: "0xaaaa000000000000000000000000000000000001",
            policy: allowOnly,
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.code).toBe("policy:counterparty_not_allowed");
    });
});
