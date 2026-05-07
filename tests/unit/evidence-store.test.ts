import { describe, expect, it } from "vitest";
import {
    canonicalEvidenceJson,
    evidenceHash,
    type EvidenceRecord,
} from "@/lib/evidence-store";

const sample: EvidenceRecord = {
    model: "anthropic/claude-haiku-4.5",
    verdict: "accept",
    reasoning: "Output matches the requested deliverable shape.",
    deliverableHash: "0xab",
};

describe("evidence-store", () => {
    it("canonicalizes evidence deterministically regardless of key order", () => {
        const a: EvidenceRecord = {
            model: "x",
            verdict: "accept",
            reasoning: "y",
            deliverableHash: "0xab",
        };
        const b: EvidenceRecord = {
            verdict: "accept",
            deliverableHash: "0xab",
            model: "x",
            reasoning: "y",
        };
        expect(canonicalEvidenceJson(a)).toBe(canonicalEvidenceJson(b));
    });

    it("evidenceHash is 32 bytes hex (0x-prefixed)", () => {
        const h = evidenceHash(sample);
        expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("hash changes when any field changes", () => {
        const h1 = evidenceHash(sample);
        const h2 = evidenceHash({ ...sample, verdict: "reject" });
        expect(h1).not.toBe(h2);
    });

    it("nested object keys are sorted recursively", () => {
        const r: EvidenceRecord = {
            ...sample,
            structuredResponse: { z_last: 1, a_first: 2 },
        };
        const canonical = canonicalEvidenceJson(r);
        const parsed = JSON.parse(canonical);
        const keys = Object.keys(parsed.structuredResponse);
        expect(keys).toEqual(["a_first", "z_last"]);
    });
});
