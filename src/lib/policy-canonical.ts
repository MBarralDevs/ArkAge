import { keccak256, toHex } from "viem";

/**
 * Off-chain policy schema. The keccak256 of the canonical JSON form
 * matches `AgentRegistry.currentPolicyHash` on-chain — that's how a
 * builder's posted policy is bound to the on-chain commitment.
 *
 * `schemaVersion` lets us evolve the policy shape; consumers must
 * branch on it (currently only v1 is defined).
 */
export interface AgentPolicy {
    schemaVersion: 1;
    agentId: string;
    version: number;
    validFrom: number;
    validTo: number | null;
    spendCaps: { perTx: string; perDay: string; perWeek: string };
    allowedContracts: string[];
    allowedSelectors: string[];
    counterpartyRules: {
        minReputation: number | null;
        allowList: string[];
        denyList: string[];
    };
    rateLimits: { jobsPerHour: number; x402CallsPerMinute: number };
    tokens: string[];
    evaluatorPreferences: {
        defaultTier: "fast" | "standard" | "premium";
        maxFeePerJob: string;
    };
}

/**
 * Recursively sort object keys alphabetically. Arrays are NOT sorted —
 * their order is semantically meaningful (e.g. allowList priority).
 */
function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        }
        return sorted;
    }
    return value;
}

export function canonicalizePolicy(policy: AgentPolicy): string {
    return JSON.stringify(sortKeysDeep(policy));
}

export function hashPolicy(policy: AgentPolicy): `0x${string}` {
    const canonical = canonicalizePolicy(policy);
    return keccak256(toHex(canonical));
}
