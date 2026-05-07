import type { Address } from "viem";
import { db } from "./db.js";
import type { AgentPolicy } from "./policy-canonical.js";

/**
 * The single struct every MCP tool gets when it needs to know "who is
 * this agent and what can they do right now?"
 *
 * Loaded once per request; caches across tools within the same handler
 * are the caller's responsibility (most tools only call this once).
 */
export interface LoadedAgent {
    dbId: bigint;
    agentId: bigint;
    operatorWallet: Address;
    identityOwner: Address;
    active: boolean;
    policy: AgentPolicy;
    perTxCap: bigint;
}

export class AgentNotFoundError extends Error {
    constructor(public readonly query: string) {
        super(`agent not found: ${query}`);
        this.name = "AgentNotFoundError";
    }
}

function bytesToHexAddress(bytes: Uint8Array | Buffer): Address {
    return ("0x" + Buffer.from(bytes).toString("hex")) as Address;
}

/**
 * Load an agent by its database id, including the latest active policy
 * (the one with `validTo: null`).
 *
 * @throws AgentNotFoundError if the agent doesn't exist or has no
 *   currently-active policy row.
 */
export async function loadAgentByDbId(dbId: bigint): Promise<LoadedAgent> {
    const row = await db.agent.findUnique({
        where: { id: dbId },
        include: {
            policies: {
                where: { validTo: null },
                orderBy: { version: "desc" },
                take: 1,
            },
            currentOperatorWallet: true,
        },
    });
    if (!row) throw new AgentNotFoundError(`dbId=${dbId}`);
    const policyRow = row.policies[0];
    if (!policyRow) throw new AgentNotFoundError(`no active policy for dbId=${dbId}`);

    const policy = policyRow.bodyJsonb as unknown as AgentPolicy;

    return {
        dbId: row.id,
        agentId: BigInt(row.agentId.toString()),
        operatorWallet: bytesToHexAddress(row.currentOperatorWallet.address),
        identityOwner: bytesToHexAddress(row.identityOwnerWallet),
        active: row.active,
        policy,
        perTxCap: BigInt(policy.spendCaps.perTx),
    };
}

/** Load an agent by its operator wallet address (case-insensitive). */
export async function loadAgentByOperator(operator: Address): Promise<LoadedAgent> {
    const wallet = await db.wallet.findUnique({
        where: {
            address: Buffer.from(operator.toLowerCase().replace(/^0x/, ""), "hex"),
        },
    });
    if (!wallet) throw new AgentNotFoundError(`operator=${operator}`);

    const agent = await db.agent.findFirst({
        where: { currentOperatorWalletId: wallet.id },
    });
    if (!agent) throw new AgentNotFoundError(`no agent for operator=${operator}`);
    return loadAgentByDbId(agent.id);
}
