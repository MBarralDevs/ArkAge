import { describe, it, expect } from "vitest";
import { shortHex, formatUsdc6, relativeTime } from "@/lib/format";

describe("format helpers", () => {
    it("shortens long hex strings", () => {
        expect(
            shortHex("0x1234567890abcdef1234567890abcdef12345678"),
        ).toBe("0x1234…5678");
    });

    it("returns short hex unchanged when under threshold", () => {
        expect(shortHex("0x1234")).toBe("0x1234");
    });

    it("formats raw USDC units (6 decimals) to human", () => {
        expect(formatUsdc6(1_000_000n)).toBe("1.00 USDC");
        expect(formatUsdc6(123_456n)).toBe("0.123456 USDC");
        expect(formatUsdc6(0n)).toBe("0.00 USDC");
    });

    it("relativeTime reports 'just now', 'm ago', 'h ago'", () => {
        const now = new Date();
        expect(relativeTime(now)).toBe("just now");
        expect(relativeTime(new Date(now.getTime() - 90_000))).toMatch(/m ago$/);
        expect(relativeTime(new Date(now.getTime() - 90 * 60_000))).toMatch(/h ago$/);
    });
});
