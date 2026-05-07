import { describe, it, expect } from "vitest";
import { issueToken, hashToken } from "@/lib/tokens";

describe("tokens", () => {
    it("issues a token with hex prefix and 64 hex chars of entropy", () => {
        const t = issueToken();
        expect(t).toMatch(/^arkage_[0-9a-f]{64}$/);
    });

    it("issues unique tokens across calls", () => {
        const a = issueToken();
        const b = issueToken();
        expect(a).not.toBe(b);
    });

    it("hashes deterministically", () => {
        const t = "arkage_" + "0".repeat(64);
        expect(hashToken(t)).toBe(hashToken(t));
    });

    it("hashes different inputs differently", () => {
        expect(hashToken("a")).not.toBe(hashToken("b"));
    });

    it("returns a 64-character hex hash (sha256)", () => {
        const h = hashToken("anything");
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
});
