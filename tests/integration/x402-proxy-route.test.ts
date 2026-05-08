import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/x402-proxy/[endpointId]/route";

vi.mock("@/lib/x402-seller-proxy", () => ({
    loadProxyEndpoint: vi.fn(async () => ({
        endpointId: 1n,
        sellerAgentDbId: 2n,
        upstreamUrl: "https://upstream.test/x",
        pricePerCall: "1000",
        sellerWallet: "0x2222000000000000000000000000000000000002",
    })),
    proxyThroughGateway: vi.fn(async () => {
        const buf = new TextEncoder().encode(
            JSON.stringify({ accepts: [] }),
        );
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        return {
            status: 402,
            body: ab,
            headers: new Headers({ "content-type": "application/json" }),
        };
    }),
    persistProxyReceipt: vi.fn(async () => null),
}));

describe("x402-proxy route", () => {
    it("returns 402 to unpaid request", async () => {
        const req = new Request(
            "https://arkage.network/api/x402-proxy/1",
            { method: "GET" },
        );
        const res = await GET(req, {
            params: Promise.resolve({ endpointId: "1" }),
        });
        expect(res.status).toBe(402);
        const body = await res.json();
        expect(body.accepts).toEqual([]);
    });

    it("returns 400 for invalid endpoint id", async () => {
        const req = new Request(
            "https://arkage.network/api/x402-proxy/notanumber",
            { method: "GET" },
        );
        const res = await GET(req, {
            params: Promise.resolve({ endpointId: "notanumber" }),
        });
        expect(res.status).toBe(400);
    });
});
