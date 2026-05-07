import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST } from "@/app/api/webhooks/circle/route";
import { db } from "@/lib/db";
import {
    _resetPublicKeyCacheForTesting,
    _setPublicKeyForTesting,
} from "@/lib/circle-webhook-verify";
import { generateKeyPairSync, sign, createPublicKey } from "node:crypto";

const TEST_KEY_ID = "11111111-1111-1111-1111-111111111111";

function makeKeypair() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const der = publicKey.export({ type: "spki", format: "der" });
    const importedPub = createPublicKey({ key: der, format: "der", type: "spki" });
    return { privateKey, publicKey: importedPub };
}

function makeRequest(opts: {
    body: object | string;
    privateKey?: ReturnType<typeof generateKeyPairSync>["privateKey"];
    signatureOverride?: string;
    keyIdOverride?: string;
    omitSignature?: boolean;
    omitKeyId?: boolean;
}): Request {
    const raw = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!opts.omitSignature) {
        const sig =
            opts.signatureOverride ??
            (opts.privateKey ? sign("sha256", Buffer.from(raw), opts.privateKey).toString("base64") : "");
        headers["x-circle-signature"] = sig;
    }
    if (!opts.omitKeyId) {
        headers["x-circle-key-id"] = opts.keyIdOverride ?? TEST_KEY_ID;
    }
    return new Request("https://x.test/api/webhooks/circle", {
        method: "POST",
        headers,
        body: raw,
    });
}

describe("POST /api/webhooks/circle", () => {
    beforeAll(() => {
        process.env.CIRCLE_API_KEY = "test-api-key";
    });

    beforeEach(async () => {
        _resetPublicKeyCacheForTesting();
        await db.auditLog.deleteMany({
            where: { actorId: "circle-webhook", targetId: { startsWith: "test-notif-" } },
        });
    });

    it("returns 401 when the signature header is missing", async () => {
        const req = makeRequest({ body: { hi: "x" }, omitSignature: true });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 401 when the key id header is missing", async () => {
        const req = makeRequest({ body: { hi: "x" }, omitKeyId: true });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 401 when the signature is invalid for the body", async () => {
        const { privateKey, publicKey } = makeKeypair();
        _setPublicKeyForTesting(TEST_KEY_ID, publicKey);
        const original = JSON.stringify({ a: 1 });
        const sig = sign("sha256", Buffer.from(original), privateKey).toString("base64");
        const req = makeRequest({ body: { a: 2 }, signatureOverride: sig });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 400 when the body is not valid JSON", async () => {
        const { privateKey, publicKey } = makeKeypair();
        _setPublicKeyForTesting(TEST_KEY_ID, publicKey);
        const garbage = "{not-json";
        const sig = sign("sha256", Buffer.from(garbage), privateKey).toString("base64");
        const req = makeRequest({ body: garbage, signatureOverride: sig });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("accepts a webhooks.test ping (verification handshake) and records it", async () => {
        const { privateKey, publicKey } = makeKeypair();
        _setPublicKeyForTesting(TEST_KEY_ID, publicKey);
        const envelope = {
            subscriptionId: "00000000-0000-0000-0000-000000000000",
            notificationId: "test-notif-handshake-1",
            notificationType: "webhooks.test",
            notification: { hello: "world" },
            timestamp: "2026-05-07T00:00:00Z",
            version: 2,
        };
        const req = makeRequest({ body: envelope, privateKey });
        const res = await POST(req);
        expect(res.status).toBe(200);

        const rows = await db.auditLog.findMany({
            where: { actorId: "circle-webhook", targetId: "test-notif-handshake-1" },
        });
        expect(rows.length).toBe(1);
        expect(rows[0]?.action).toBe("circle.webhooks.test");
    });

    it("accepts a contracts.events.created notification and records it", async () => {
        const { privateKey, publicKey } = makeKeypair();
        _setPublicKeyForTesting(TEST_KEY_ID, publicKey);
        const envelope = {
            subscriptionId: "00000000-0000-0000-0000-000000000000",
            notificationId: "test-notif-event-1",
            notificationType: "contracts.events.created",
            notification: {
                contractAddress: "0x" + "11".repeat(20),
                eventName: "AgentRegistered",
                params: { agentId: "1" },
            },
            timestamp: "2026-05-07T00:00:00Z",
            version: 2,
        };
        const req = makeRequest({ body: envelope, privateKey });
        const res = await POST(req);
        expect(res.status).toBe(200);

        const rows = await db.auditLog.findMany({
            where: { actorId: "circle-webhook", targetId: "test-notif-event-1" },
        });
        expect(rows.length).toBe(1);
        expect(rows[0]?.action).toBe("circle.contracts.events.created");
    });

    it("is idempotent on duplicate notificationId", async () => {
        const { privateKey, publicKey } = makeKeypair();
        _setPublicKeyForTesting(TEST_KEY_ID, publicKey);
        const envelope = {
            subscriptionId: "00000000-0000-0000-0000-000000000000",
            notificationId: "test-notif-dup-1",
            notificationType: "webhooks.test",
            notification: { hello: "world" },
            timestamp: "2026-05-07T00:00:00Z",
            version: 2,
        };
        const req1 = makeRequest({ body: envelope, privateKey });
        const req2 = makeRequest({ body: envelope, privateKey });

        expect((await POST(req1)).status).toBe(200);
        expect((await POST(req2)).status).toBe(200);

        const rows = await db.auditLog.findMany({
            where: { actorId: "circle-webhook", targetId: "test-notif-dup-1" },
        });
        expect(rows.length).toBe(1);
    });
});
