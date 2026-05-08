import { describe, it, expect } from "vitest";
import { verifyX402FacilitatorWebhook } from "@/lib/x402-facilitator-verify";
import { createHmac } from "node:crypto";

const SECRET = "test-x402-fac-secret-32-chars-min";

function sign(body: string): string {
    return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifyX402FacilitatorWebhook", () => {
    it("accepts valid signature", () => {
        const body = JSON.stringify({ event: "settled" });
        expect(
            verifyX402FacilitatorWebhook(body, sign(body), SECRET),
        ).toBe(true);
    });

    it("rejects bad signature", () => {
        expect(
            verifyX402FacilitatorWebhook("x", "deadbeef", SECRET),
        ).toBe(false);
    });

    it("rejects malformed hex signature", () => {
        expect(
            verifyX402FacilitatorWebhook("x", "not-hex-at-all", SECRET),
        ).toBe(false);
    });
});
