import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify the HMAC SHA-256 signature on a Circle x402 facilitator
 * webhook request.
 *
 * SDK note: this is the v1 testnet assumption per Plan D Task 9.
 * Circle's Smart Contract Platform webhooks (Plan A) use ECDSA +
 * public key (no shared secret); the x402 facilitator product is
 * documented separately and is expected to use HMAC. Verify against
 * Circle's x402 webhook docs before any production deploy and adapt
 * the verifier if needed.
 */
export function verifyX402FacilitatorWebhook(
    rawBody: string,
    receivedSigHex: string,
    secret: string,
): boolean {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    let received: Buffer;
    try {
        received = Buffer.from(receivedSigHex, "hex");
    } catch {
        return false;
    }
    if (received.length !== expected.length) return false;
    return timingSafeEqual(expected, received);
}
