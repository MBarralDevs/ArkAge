import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Circle Contract Platform webhook signature.
 *
 * Circle signs each webhook body with HMAC-SHA256 using the secret you
 * configured at endpoint creation. The signature is delivered as a hex
 * string in the `x-circle-signature` request header.
 *
 * This function uses `timingSafeEqual` to prevent signature-comparison
 * timing attacks (the function reveals nothing about how close a wrong
 * signature is to the right one).
 *
 * @param rawBody — the raw request body as received (do NOT re-stringify
 *   parsed JSON; whitespace differences invalidate the signature)
 * @param receivedSignatureHex — the hex string from `x-circle-signature`
 * @param secret — the webhook secret from Circle Console / env
 * @returns true iff the signature matches
 */
export function verifyCircleWebhook(
    rawBody: string,
    receivedSignatureHex: string,
    secret: string,
): boolean {
    const expected = createHmac("sha256", secret).update(rawBody).digest();

    let received: Buffer;
    try {
        received = Buffer.from(receivedSignatureHex, "hex");
    } catch {
        return false;
    }

    if (received.length !== expected.length) return false;
    return timingSafeEqual(expected, received);
}
