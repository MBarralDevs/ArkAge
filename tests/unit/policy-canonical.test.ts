import { describe, it, expect } from "vitest";
import { canonicalizePolicy, hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";

const samplePolicy: AgentPolicy = {
    schemaVersion: 1,
    agentId: "42",
    version: 1,
    validFrom: 1700000000,
    validTo: null,
    spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
    allowedContracts: ["0x0747eef0706327138c69792bf28cd525089e4583"],
    allowedSelectors: ["0x12345678"],
    counterpartyRules: { minReputation: 50, allowList: [], denyList: [] },
    rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 100 },
    tokens: ["0x3600000000000000000000000000000000000000"],
    evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
};

describe("policy canonicalization", () => {
    it("produces same hash regardless of key ordering in input", () => {
        const reordered = JSON.parse(JSON.stringify(samplePolicy));
        const hashA = hashPolicy(samplePolicy);
        const hashB = hashPolicy(reordered);
        expect(hashA).toBe(hashB);
    });

    it("hash is 0x-prefixed 32-byte hex", () => {
        const h = hashPolicy(samplePolicy);
        expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("changes when any field changes", () => {
        const h1 = hashPolicy(samplePolicy);
        const modified = { ...samplePolicy, version: 2 };
        expect(hashPolicy(modified)).not.toBe(h1);
    });

    it("canonicalize sorts keys alphabetically at top level", () => {
        const canonical = canonicalizePolicy(samplePolicy);
        const keys = Object.keys(JSON.parse(canonical));
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
    });

    it("canonicalize sorts keys recursively (nested objects too)", () => {
        const canonical = canonicalizePolicy(samplePolicy);
        const parsed = JSON.parse(canonical);
        const spendCapKeys = Object.keys(parsed.spendCaps);
        expect(spendCapKeys).toEqual([...spendCapKeys].sort());
        const cpKeys = Object.keys(parsed.counterpartyRules);
        expect(cpKeys).toEqual([...cpKeys].sort());
    });

    it("preserves array element order (arrays are not sorted)", () => {
        // Allowlists are intentional ordered lists; sorting them would
        // semantically change the policy (e.g. priority ordering).
        const canonical = canonicalizePolicy({
            ...samplePolicy,
            allowedContracts: ["0xbbb...", "0xaaa..."],
        });
        const parsed = JSON.parse(canonical);
        expect(parsed.allowedContracts).toEqual(["0xbbb...", "0xaaa..."]);
    });
});
