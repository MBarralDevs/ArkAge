import { createHash, randomBytes } from "node:crypto";

/**
 * MCP bearer-token issuance + verification.
 *
 * Tokens are issued in plaintext form to the holder once (e.g. on builder
 * onboarding) but are stored only as SHA-256 hashes server-side. The
 * dispatch layer hashes the inbound bearer header and looks up the row
 * in audit_log (action=token.issued).
 *
 * Format: `arkage_<64-char hex>` — 32 bytes of crypto-random entropy.
 */

export function issueToken(): string {
    const entropy = randomBytes(32).toString("hex");
    return `arkage_${entropy}`;
}

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
