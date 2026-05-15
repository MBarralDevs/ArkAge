import type { Address } from "viem";
import { publicClient } from "./chain";
import { ARC_TESTNET_ADDRESSES } from "./addresses";
import { ERC8183_ABI } from "./abis";

/**
 * Job status enum mirrors the ERC-8183 spec state machine. Index order
 * matches the on-chain `uint8 status` field — keep them in sync.
 */
export type JobStatusEnum =
    | "Open"
    | "Funded"
    | "Submitted"
    | "Completed"
    | "Rejected"
    | "Expired";

const STATUS_LABELS: readonly JobStatusEnum[] = [
    "Open",
    "Funded",
    "Submitted",
    "Completed",
    "Rejected",
    "Expired",
];

export interface OnChainJob {
    id: bigint;
    client: Address;
    provider: Address;
    evaluator: Address;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: JobStatusEnum;
    hook: Address;
}

/**
 * Read the canonical job tuple from the ERC-8183 AgenticCommerce contract.
 *
 * The struct order is verified against the deployed implementation
 * (0xa316…351a, the ERC-1967 impl behind the 0x0747… proxy):
 * {id, client, provider, evaluator, description, budget, expiredAt,
 * status, hook}. The deliverable hash is NOT in the struct — it lives
 * only in the JobSubmitted event.
 */
export async function readJob(jobId: bigint): Promise<OnChainJob> {
    const raw = await publicClient.readContract({
        address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        abi: ERC8183_ABI,
        functionName: "getJob",
        args: [jobId],
    });
    const statusIndex = Number(raw.status);
    const status = STATUS_LABELS[statusIndex];
    if (!status) throw new Error(`Unknown job status index ${statusIndex}`);
    return {
        id: raw.id,
        client: raw.client,
        provider: raw.provider,
        evaluator: raw.evaluator,
        description: raw.description,
        budget: raw.budget,
        expiredAt: raw.expiredAt,
        status,
        hook: raw.hook,
    };
}

/** True for terminal states (no further transitions possible). */
export function isTerminalState(s: JobStatusEnum): boolean {
    return s === "Completed" || s === "Rejected" || s === "Expired";
}
