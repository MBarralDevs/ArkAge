import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign, createPublicKey } from "node:crypto";
import { verifyCircleSignature } from "@/lib/circle-webhook-verify";

function makeKeypair() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
        namedCurve: "P-256",
    });
    // Re-import publicKey from DER/SPKI to mirror the production code path
    // (createPublicKey from base64-decoded SPKI bytes).
    const der = publicKey.export({ type: "spki", format: "der" });
    const importedPub = createPublicKey({ key: der, format: "der", type: "spki" });
    return { privateKey, publicKey: importedPub };
}

function signBody(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], body: string): string {
    return sign("sha256", Buffer.from(body), privateKey).toString("base64");
}

describe("verifyCircleSignature", () => {
    it("accepts a signature produced by the matching private key", () => {
        const { privateKey, publicKey } = makeKeypair();
        const body = JSON.stringify({ notificationType: "webhooks.test" });
        const sig = signBody(privateKey, body);
        expect(verifyCircleSignature(body, sig, publicKey)).toBe(true);
    });

    it("rejects a signature from a different keypair", () => {
        const { publicKey } = makeKeypair();
        const { privateKey: otherPriv } = makeKeypair();
        const body = JSON.stringify({ notificationType: "webhooks.test" });
        const sig = signBody(otherPriv, body);
        expect(verifyCircleSignature(body, sig, publicKey)).toBe(false);
    });

    it("rejects when body is tampered after signing", () => {
        const { privateKey, publicKey } = makeKeypair();
        const original = JSON.stringify({ notificationType: "webhooks.test" });
        const sig = signBody(privateKey, original);
        const tampered = JSON.stringify({ notificationType: "tampered" });
        expect(verifyCircleSignature(tampered, sig, publicKey)).toBe(false);
    });

    it("rejects garbage base64 without throwing", () => {
        const { publicKey } = makeKeypair();
        expect(verifyCircleSignature("anything", "===not-valid-base64===", publicKey)).toBe(false);
    });

    it("rejects empty signature", () => {
        const { publicKey } = makeKeypair();
        expect(verifyCircleSignature("anything", "", publicKey)).toBe(false);
    });

    it("verifies the canonical Circle docs example end-to-end", () => {
        // Reproduce the verification from
        // https://developers.circle.com/wallets/webhook-notifications
        const publicKeyBase64 =
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESl76SZPBJemW0mJNN4KTvYkLT8bOT4UGhFhzNk3fJqf6iuPlLQLq533FelXwczJbjg2U1PHTvQTK7qOQnDL2Tg==";
        const signatureBase64 =
            "MEQCIBlJPX7t0FDOcozsRK6qIQwik5Fq6mhAtCSSgIB/yQO7AiB9U5lVpdufKvPhk3cz4TH2f5MP7ArnmPRBmhPztpsIFQ==";
        const message =
            '{"subscriptionId":"00000000-0000-0000-0000-000000000000","notificationId":"00000000-0000-0000-0000-000000000000","notificationType":"webhooks.test","notification":{"hello":"world"},"timestamp":"2024-01-26T18:22:19.779834211Z","version":2}';

        const publicKey = createPublicKey({
            key: Buffer.from(publicKeyBase64, "base64"),
            format: "der",
            type: "spki",
        });
        expect(verifyCircleSignature(message, signatureBase64, publicKey)).toBe(true);
    });
});
