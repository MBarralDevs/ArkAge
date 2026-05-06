import { describe, it, expect } from "vitest";
import { verifyCircleWebhook } from "@/lib/circle-webhook-verify";
import { createHmac } from "node:crypto";

const SECRET = "test-secret-min-16-chars";

function sign(body: string, secret = SECRET): string {
    return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyCircleWebhook", () => {
    it("accepts a valid signature", () => {
        const body = JSON.stringify({ event: "test" });
        const sig = sign(body);
        expect(verifyCircleWebhook(body, sig, SECRET)).toBe(true);
    });

    it("rejects an invalid signature", () => {
        const body = JSON.stringify({ event: "test" });
        expect(verifyCircleWebhook(body, "deadbeef", SECRET)).toBe(false);
    });

    it("rejects when body is tampered", () => {
        const body1 = JSON.stringify({ event: "test" });
        const sig = sign(body1);
        const body2 = JSON.stringify({ event: "tampered" });
        expect(verifyCircleWebhook(body2, sig, SECRET)).toBe(false);
    });

    it("rejects right-length-wrong-value AND short-value (constant-time smoke check)", () => {
        const body = "x";
        expect(verifyCircleWebhook(body, "00".repeat(32), SECRET)).toBe(false);
        expect(verifyCircleWebhook(body, "00", SECRET)).toBe(false);
    });

    it("rejects garbage hex without throwing", () => {
        const body = "x";
        expect(verifyCircleWebhook(body, "not-hex-at-all", SECRET)).toBe(false);
    });
});
