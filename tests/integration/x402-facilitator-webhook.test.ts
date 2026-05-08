import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "test-x402-fac-secret-32-chars-min";

beforeAll(() => {
    process.env.CIRCLE_X402_FACILITATOR_SECRET = SECRET;
});

vi.mock("@/workers/ingest-x402-settlement", () => ({
    ingestFacilitatorEvent: vi.fn(async () => undefined),
}));

function makeReq(payload: object): Request {
    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    return new Request(
        "https://x.test/api/webhooks/circle-x402-facilitator",
        {
            method: "POST",
            headers: {
                "x-circle-signature": sig,
                "content-type": "application/json",
            },
            body,
        },
    );
}

describe("x402 facilitator webhook", () => {
    it("rejects bad signature", async () => {
        const { POST } = await import(
            "@/app/api/webhooks/circle-x402-facilitator/route"
        );
        const body = JSON.stringify({ eventType: "settle" });
        const req = new Request(
            "https://x.test/api/webhooks/circle-x402-facilitator",
            {
                method: "POST",
                headers: {
                    "x-circle-signature": "deadbeef",
                    "content-type": "application/json",
                },
                body,
            },
        );
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("rejects missing signature header", async () => {
        const { POST } = await import(
            "@/app/api/webhooks/circle-x402-facilitator/route"
        );
        const body = JSON.stringify({ eventType: "settle" });
        const req = new Request(
            "https://x.test/api/webhooks/circle-x402-facilitator",
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body,
            },
        );
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("accepts valid batch_completed event", async () => {
        const { POST } = await import(
            "@/app/api/webhooks/circle-x402-facilitator/route"
        );
        const res = await POST(
            makeReq({
                eventType: "batch_completed",
                data: {
                    settlementTxHash: "0x" + "ab".repeat(32),
                    sellerWallet: "0x" + "11".repeat(20),
                    amountTotal: "100000",
                    facilitatorFee: "1000",
                    settledAt: new Date().toISOString(),
                },
            }),
        );
        expect(res.status).toBe(200);
    });
});
