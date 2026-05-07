import { createPublicKey, verify } from "node:crypto";

/**
 * Circle Web3 Services webhook signature verification.
 *
 * Circle signs every webhook with an **ECDSA-SHA256 keypair** (NOT HMAC
 * with a shared secret). Each webhook arrives with two headers:
 *
 *   X-Circle-Signature   — base64-encoded ECDSA signature over the raw body
 *   X-Circle-Key-Id      — UUID of the public key used to sign
 *
 * Verification flow:
 *   1. Read the two headers
 *   2. Look up the public key by id (cached in-memory)
 *   3. ECDSA-verify body bytes against the signature
 *
 * Public keys are static per keyId, so we cache them indefinitely on the
 * function instance (Fluid Compute reuses instances, so this stays warm
 * across invocations).
 */

const CIRCLE_API_BASE = "https://api.circle.com";

interface CirclePublicKeyResponse {
    data: {
        id: string;
        algorithm: string;
        publicKey: string;
        createDate: string;
    };
}

const publicKeyCache = new Map<string, { keyObject: ReturnType<typeof createPublicKey>; algorithm: string }>();

/**
 * Fetch (and cache) Circle's public key for a given keyId.
 *
 * Network call only on cache miss. Uses CIRCLE_API_KEY for auth.
 *
 * @throws if the keyId is unknown or the API rejects auth
 */
export async function fetchCirclePublicKey(
    keyId: string,
    apiKey: string,
): Promise<{ keyObject: ReturnType<typeof createPublicKey>; algorithm: string }> {
    const cached = publicKeyCache.get(keyId);
    if (cached) return cached;

    const res = await fetch(`${CIRCLE_API_BASE}/v2/notifications/publicKey/${keyId}`, {
        method: "GET",
        headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
        },
    });
    if (!res.ok) {
        throw new Error(`Circle public key fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as CirclePublicKeyResponse;
    const publicKeyBytes = Buffer.from(json.data.publicKey, "base64");
    const keyObject = createPublicKey({
        key: publicKeyBytes,
        format: "der",
        type: "spki",
    });
    const entry = { keyObject, algorithm: json.data.algorithm };
    publicKeyCache.set(keyId, entry);
    return entry;
}

/**
 * Verify a Circle webhook signature against a fetched public key.
 *
 * Pure function — no IO, no env reads, suitable for table-driven tests.
 *
 * @param rawBody — request body exactly as received (do NOT re-stringify
 *   parsed JSON; whitespace differences invalidate the signature)
 * @param signatureBase64 — value of X-Circle-Signature header
 * @param publicKey — KeyObject returned by fetchCirclePublicKey
 */
export function verifyCircleSignature(
    rawBody: string,
    signatureBase64: string,
    publicKey: ReturnType<typeof createPublicKey>,
): boolean {
    let signatureBytes: Buffer;
    try {
        signatureBytes = Buffer.from(signatureBase64, "base64");
    } catch {
        return false;
    }
    if (signatureBytes.length === 0) return false;

    try {
        return verify("sha256", Buffer.from(rawBody), publicKey, signatureBytes);
    } catch {
        return false;
    }
}

/**
 * Test-only: clear the public key cache. Used by integration tests that
 * inject mock keys.
 */
export function _resetPublicKeyCacheForTesting(): void {
    publicKeyCache.clear();
}

/**
 * Test-only: pre-populate the cache with a known public key. Used by
 * integration tests so they don't need to mock fetch.
 */
export function _setPublicKeyForTesting(
    keyId: string,
    keyObject: ReturnType<typeof createPublicKey>,
    algorithm = "ECDSA_SHA_256",
): void {
    publicKeyCache.set(keyId, { keyObject, algorithm });
}
