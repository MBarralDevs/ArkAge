import type { Address } from "viem";

/**
 * The authenticated context every MCP tool handler receives.
 *
 * `actingAgentId` is null when the bearer token is scoped to a builder but
 * not pinned to a specific agent (e.g., during onboarding before any
 * agents are registered). Tools that mutate per-agent state must reject
 * the request when actingAgentId is null.
 */
export interface McpAuthContext {
    /** Bearer token raw value, validated against tokens table */
    token: string;
    /** Resolved actor: which builder + which agent this call is acting on behalf of */
    builderId: bigint;
    actingAgentId: bigint | null;
    actingWalletAddress: Address;
}

export class McpAuthError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "McpAuthError";
    }
}
