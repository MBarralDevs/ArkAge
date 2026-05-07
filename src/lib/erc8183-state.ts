import type { Address } from "viem";
import { publicClient } from "./chain.js";
import { ARC_TESTNET_ADDRESSES } from "./addresses.js";
import { ERC8183_ABI } from "./abis.js";

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
    client: Address;
    provider: Address;
    evaluator: Address;
    budget: bigint;
    expiredAt: bigint;
    status: JobStatusEnum;
    reason: `0x${string}`;
    hook: Address;
}

/** Read the canonical job tuple from the ERC-8183 AgenticCommerce contract. */
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
        client: raw.client,
        provider: raw.provider,
        evaluator: raw.evaluator,
        budget: raw.budget,
        expiredAt: raw.expiredAt,
        status,
        reason: raw.reason,
        hook: raw.hook,
    };
}

/** True for terminal states (no further transitions possible). */
export function isTerminalState(s: JobStatusEnum): boolean {
    return s === "Completed" || s === "Rejected" || s === "Expired";
}
