import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST } from "@/app/api/webhooks/circle/route";
import { db } from "@/lib/db";
import { createHmac } from "node:crypto";

const SECRET = "test-secret-min-16-chars";

function makeRequest(body: object | string, signature?: string): Request {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const sig = signature ?? createHmac("sha256", SECRET).update(raw).digest("hex");
    return new Request("https://x.test/api/webhooks/circle", {
        method: "POST",
        headers: { "x-circle-signature": sig, "content-type": "application/json" },
        body: raw,
    });
}

describe("POST /api/webhooks/circle", () => {
    beforeAll(() => {
        process.env.CIRCLE_WEBHOOK_SECRET = SECRET;
    });

    beforeEach(async () => {
        // Clean up any rows from prior runs of this suite to keep assertions tight.
        await db.auditLog.deleteMany({
            where: { actorId: "circle-webhook", targetId: { startsWith: "0x1111" } },
        });
    });

    it("returns 401 when the signature is missing", async () => {
        const raw = JSON.stringify({ event: "test" });
        const req = new Request("https://x.test/api/webhooks/circle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: raw,
        });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 401 when the signature is invalid", async () => {
        const req = makeRequest({ event: "test" }, "deadbeef");
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 400 when the body is not valid JSON", async () => {
        const req = makeRequest("{not-json");
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("accepts a valid event and writes it to audit_log", async () => {
        const event = {
            eventType: "contracts.event",
            data: {
                contractAddress: "0x" + "11".repeat(20),
                eventName: "AgentRegistered",
                txHash: "0x" + "ab".repeat(32),
                logIndex: 0,
                blockNumber: "1234",
                blockTime: "2026-05-02T12:00:00Z",
                params: { agentId: "1" },
            },
        };
        const req = makeRequest(event);
        const res = await POST(req);
        expect(res.status).toBe(200);

        const rows = await db.auditLog.findMany({
            where: { actorId: "circle-webhook", targetId: event.data.contractAddress },
        });
        expect(rows.length).toBe(1);
        expect(rows[0]?.action).toBe("chain.AgentRegistered");
    });

    it("ignores events with eventType other than contracts.event", async () => {
        const event = {
            eventType: "wallets.transaction.created",
            data: { contractAddress: "0x" + "11".repeat(20), eventName: "noop" },
        };
        const req = makeRequest(event);
        const res = await POST(req);
        expect(res.status).toBe(200);

        const rows = await db.auditLog.findMany({
            where: { actorId: "circle-webhook", targetId: event.data.contractAddress },
        });
        expect(rows.length).toBe(0);
    });
});
