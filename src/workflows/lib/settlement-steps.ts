import { encodeFunctionData } from "viem";
import { ERC8183_ABI, ERC8004_REPUTATION_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier3 } from "@/lib/tier3-system";
import type { QueuedDcwTx } from "@/lib/tier2-dcw";
import { db } from "@/lib/db";

/**
 * Settlement step wrappers — called from the evaluator and lifecycle
 * workflows once an evaluation reaches a verdict.
 *
 * Each function is marked `"use step"` so it has full Node.js access
 * (DCW SDK + chain RPC). Settlement always happens via Tier 3 wallets:
 *  - complete/reject → validator (the role authorized to settle jobs)
 *  - tryClaimRefund → gas-funder (cleanup role, refunds go back to
 *    the original funder regardless of who calls)
 *
 * Returns the queued Circle DCW transaction reference. Workflows track
 * onchain landing via deterministic hook tokens (jobTerminalToken),
 * not synchronous txHash, so we don't waitForTxHash here.
 *
 * Logging at entry/exit is critical for debugging stuck workflows
 * (per CLAUDE.md guidance for the workflow domain).
 */

export async function callComplete(
    jobId: bigint,
    reason: `0x${string}`,
): Promise<QueuedDcwTx> {
    "use step";
    console.log(`[settlement] callComplete enter jobId=${jobId} reason=${reason}`);
    const data = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "complete",
        args: [jobId, reason, "0x"],
    });
    const result = await signWithTier3(
        "validator",
        ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        data,
    );
    console.log(
        `[settlement] callComplete exit jobId=${jobId} transactionId=${result.transactionId} state=${result.state}`,
    );
    return result;
}

export async function callReject(
    jobId: bigint,
    reason: `0x${string}`,
): Promise<QueuedDcwTx> {
    "use step";
    console.log(`[settlement] callReject enter jobId=${jobId} reason=${reason}`);
    const data = encodeFunctionData({
        abi: ERC8183_ABI,
        functionName: "reject",
        args: [jobId, reason, "0x"],
    });
    const result = await signWithTier3(
        "validator",
        ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        data,
    );
    console.log(
        `[settlement] callReject exit jobId=${jobId} transactionId=${result.transactionId} state=${result.state}`,
    );
    return result;
}

export type ClaimRefundResult =
    | { kind: "queued"; transactionId: string; state: string }
    | { kind: "skipped"; reason: string };

/**
 * Best-effort refund cleanup. Called by the lifecycle workflow when a
 * job times out without settlement. Failures are caught + returned as
 * a `skipped` outcome — refunds are non-critical (the funder can call
 * claimRefund themselves), so we never bubble.
 */
export async function tryClaimRefund(jobId: bigint): Promise<ClaimRefundResult> {
    "use step";
    console.log(`[settlement] tryClaimRefund enter jobId=${jobId}`);
    try {
        const data = encodeFunctionData({
            abi: ERC8183_ABI,
            functionName: "claimRefund",
            args: [jobId],
        });
        const result = await signWithTier3(
            "gas-funder",
            ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
            data,
        );
        console.log(
            `[settlement] tryClaimRefund exit jobId=${jobId} transactionId=${result.transactionId}`,
        );
        return {
            kind: "queued",
            transactionId: result.transactionId,
            state: result.state,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`[settlement] tryClaimRefund skipped jobId=${jobId} reason=${message}`);
        return { kind: "skipped", reason: message };
    }
}

export type GiveFeedbackResult =
    | { kind: "queued"; transactionId: string; state: string; agentId: string }
    | { kind: "skipped"; reason: string };

/**
 * Write on-chain reputation directly to the ERC-8004 ReputationRegistry
 * (Option C — decoupled from the hook chain).
 *
 * The canonical design routes reputation through `ReputationHook`, but
 * that hook only fires if HookComposer is whitelisted on the ERC-8183
 * deployment. `ReputationRegistry.giveFeedback` is permissionless, so
 * the evaluator's Tier 3 validator can write feedback directly after
 * settling the job — same `feedbackHash` as the ERC-8183 `reason`, so
 * the evaluation → settlement → reputation cryptographic thread holds.
 *
 * Feedback targets an agent's ERC-8004 identity (`chainAgentId`). A
 * provider that hasn't anchored on-chain has no identity to receive
 * feedback — that's correct protocol behaviour, so we skip rather than
 * fail. Failures never bubble: a settled job must not be un-settled
 * because a follow-up reputation write hiccuped.
 */
export async function writeReputationFeedback(args: {
    jobId: bigint;
    score: number;
    verdict: "accept" | "reject";
    evidenceUri: string;
    evidenceHash: `0x${string}`;
}): Promise<GiveFeedbackResult> {
    "use step";
    console.log(
        `[settlement] writeReputationFeedback enter jobId=${args.jobId} verdict=${args.verdict}`,
    );
    const job = await db.job.findUnique({
        where: { jobId: args.jobId.toString() },
        include: { providerAgent: true },
    });
    if (!job?.providerAgent) {
        console.log(
            `[settlement] writeReputationFeedback skipped jobId=${args.jobId} — no provider agent`,
        );
        return { kind: "skipped", reason: "no provider agent on job" };
    }
    const chainAgentId = job.providerAgent.chainAgentId;
    if (chainAgentId === null) {
        console.log(
            `[settlement] writeReputationFeedback skipped jobId=${args.jobId} — provider not ERC-8004 anchored`,
        );
        return {
            kind: "skipped",
            reason: "provider agent not ERC-8004 anchored",
        };
    }
    try {
        const data = encodeFunctionData({
            abi: ERC8004_REPUTATION_ABI,
            functionName: "giveFeedback",
            args: [
                chainAgentId,
                BigInt(Math.trunc(args.score)),
                0,
                "arkage-evaluation",
                args.verdict,
                "",
                args.evidenceUri,
                args.evidenceHash,
            ],
        });
        const result = await signWithTier3(
            "validator",
            ARC_TESTNET_ADDRESSES.ERC_8004_REPUTATION_REGISTRY,
            data,
        );
        console.log(
            `[settlement] writeReputationFeedback exit jobId=${args.jobId} agentId=${chainAgentId} transactionId=${result.transactionId}`,
        );
        return {
            kind: "queued",
            transactionId: result.transactionId,
            state: result.state,
            agentId: chainAgentId.toString(),
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(
            `[settlement] writeReputationFeedback failed jobId=${args.jobId} reason=${message}`,
        );
        return { kind: "skipped", reason: message };
    }
}
