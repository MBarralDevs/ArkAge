import type { Address } from "viem";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { ok, err, type Result } from "./result.js";
import type { McpAuthContext } from "./auth.js";

/**
 * Resolve the authenticated context for an inbound MCP HTTP request.
 *
 * The bearer token is hashed (SHA-256) and the hash is looked up in
 * `audit_log` under `actor_kind='token', action='token.issued'`. The
 * issuance row's `payload_jsonb` carries the builder/agent/wallet
 * association. This indirection lets us revoke tokens by deleting the
 * row without touching live state elsewhere.
 *
 * The result envelope mirrors MCP tool returns: `Result<McpAuthContext>`,
 * so the route can branch identically on `ok`.
 */
export async function resolveAuthContext(
    request: Request,
): Promise<Result<McpAuthContext>> {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
        return err("missing_auth", "Authorization: Bearer <token> header required");
    }
    const token = auth.slice("Bearer ".length).trim();
    if (!/^arkage_[0-9a-f]{64}$/.test(token)) {
        return err("malformed_token", "Token must match arkage_<64 hex>");
    }

    const tokenHash = hashToken(token);
    const row = await db.auditLog.findFirst({
        where: { actorKind: "token", actorId: tokenHash, action: "token.issued" },
        orderBy: { createdAt: "desc" },
    });

    if (!row) {
        return err("invalid_token", "Token not recognized");
    }

    const payload = row.payloadJsonb as
        | { builderId: string; agentId?: string; walletAddress: string }
        | null;
    if (!payload) {
        return err("invalid_token", "Token payload missing");
    }

    return ok({
        token,
        builderId: BigInt(payload.builderId),
        actingAgentId: payload.agentId ? BigInt(payload.agentId) : null,
        actingWalletAddress: payload.walletAddress as Address,
    });
}
