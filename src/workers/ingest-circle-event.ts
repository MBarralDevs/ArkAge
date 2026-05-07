import { db } from "@/lib/db";
import { resumeHook } from "workflow/api";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import {
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
} from "@/workflows/lib/hook-tokens";

/**
 * Circle Web3 Services / Smart Contract Platform webhook envelope.
 *
 * `notificationType` examples:
 *   - "webhooks.test"  — verification ping fired by Circle on creation
 *                        or "Retry connection" click
 *   - "contracts.events.created"  — a contract event was indexed by
 *                        Circle's event monitor (the body shape is
 *                        defined by `ContractEventNotification` below)
 */
export interface CircleNotificationEnvelope {
    subscriptionId: string;
    notificationId: string;
    notificationType: string;
    notification: Record<string, unknown>;
    timestamp: string;
    version: number;
}

/**
 * The inner `notification` payload for `contracts.events.created` events
 * indexed by Circle Smart Contract Platform. Each notification represents
 * a single decoded event log.
 */
interface ContractEventNotification {
    contractAddress: string;
    eventName: string;
    txHash: string;
    logIndex: number;
    blockNumber: string | number;
    blockTime: string;
    params: Record<string, unknown>;
}

const ARC_CHAIN_ID = 5042002;

function bytesFromHex(hex: string) {
    return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

async function handleAgentRegistered(
    data: ContractEventNotification,
): Promise<void> {
    const params = data.params as {
        agentId?: string;
        operator?: string;
        policyHash?: string;
    };
    if (!params.agentId || !params.operator) return;

    const operatorBytes = bytesFromHex(params.operator);
    const wallet = await db.wallet.findUnique({
        where: { address: operatorBytes },
    });
    if (!wallet) return;

    await db.agent.upsert({
        where: { agentId: params.agentId },
        update: { active: true, currentOperatorWalletId: wallet.id },
        create: {
            agentId: params.agentId,
            identityOwnerWallet: bytesFromHex(params.operator),
            currentOperatorWalletId: wallet.id,
            agentWalletAddress: operatorBytes,
            registeredAtBlock: BigInt(data.blockNumber),
            active: true,
        },
    });
}

async function handle8183JobEvent(
    data: ContractEventNotification,
    tokenFn: (jobId: bigint) => string,
    eventKind: string,
): Promise<void> {
    const jobIdRaw = (data.params as { jobId?: string }).jobId;
    if (!jobIdRaw) return;
    const jobId = BigInt(jobIdRaw);

    const job = await db.job.findUnique({
        where: { jobId: jobId.toString() },
    });
    if (job) {
        await db.jobEvent.create({
            data: {
                jobId: job.id,
                eventKind,
                actorAddress: bytesFromHex(
                    ((data.params as { actor?: string }).actor) ??
                        data.contractAddress,
                ),
                payloadJsonb: data.params as object,
                chainId: ARC_CHAIN_ID,
                txHash: bytesFromHex(data.txHash),
                logIndex: data.logIndex,
                blockNumber: BigInt(data.blockNumber),
                blockTime: new Date(data.blockTime),
            },
        });
    }

    await resumeHook(tokenFn(jobId), data.params);
}

async function handleReputationFeedback(
    data: ContractEventNotification,
): Promise<void> {
    const p = data.params as {
        agentId?: string;
        value?: number;
        tag1?: string;
        tag2?: string;
        feedbackHash?: string;
    };
    if (!p.agentId) return;
    const agent = await db.agent.findUnique({
        where: { agentId: p.agentId },
    });
    if (!agent) return;

    await db.reputationFeedback.upsert({
        where: {
            chainId_txHash_logIndex: {
                chainId: ARC_CHAIN_ID,
                txHash: bytesFromHex(data.txHash),
                logIndex: data.logIndex,
            },
        },
        update: {},
        create: {
            agentId: agent.id,
            submitterAddress: bytesFromHex(data.contractAddress),
            source: "arkage_hook",
            score: p.value ?? null,
            tag1: p.tag1 ?? null,
            tag2: p.tag2 ?? null,
            feedbackHash: p.feedbackHash ? bytesFromHex(p.feedbackHash) : null,
            chainId: ARC_CHAIN_ID,
            txHash: bytesFromHex(data.txHash),
            logIndex: data.logIndex,
            blockTime: new Date(data.blockTime),
        },
    });
}

async function routeContractEvent(
    notification: ContractEventNotification,
): Promise<void> {
    const addr = notification.contractAddress.toLowerCase();

    if (notification.eventName === "AgentRegistered") {
        await handleAgentRegistered(notification);
        return;
    }

    if (
        addr === ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE.toLowerCase()
    ) {
        if (notification.eventName === "JobFunded") {
            await handle8183JobEvent(notification, jobFundedToken, "funded");
            return;
        }
        if (notification.eventName === "JobSubmitted") {
            await handle8183JobEvent(notification, jobSubmittedToken, "submitted");
            return;
        }
        if (notification.eventName === "JobCompleted") {
            await handle8183JobEvent(notification, jobTerminalToken, "completed");
            return;
        }
        if (notification.eventName === "JobRejected") {
            await handle8183JobEvent(notification, jobTerminalToken, "rejected");
            return;
        }
    }

    if (
        addr === ARC_TESTNET_ADDRESSES.ERC_8004_REPUTATION_REGISTRY.toLowerCase()
    ) {
        if (notification.eventName === "FeedbackGiven") {
            await handleReputationFeedback(notification);
        }
    }
}

/**
 * Plan B route: domain-table writes + workflow resumeHook firing.
 *
 * Idempotent on (notificationId): a duplicate redelivery is a no-op
 * because we look up the prior audit_log row first. Per-event idempotency
 * for chain writes is enforced by the (chainId, txHash, logIndex) unique
 * indexes on `job_events` and `reputation_feedback`.
 */
export async function ingestCircleEvent(
    payload: CircleNotificationEnvelope,
): Promise<void> {
    const existing = await db.auditLog.findFirst({
        where: { actorId: "circle-webhook", targetId: payload.notificationId },
        select: { id: true },
    });
    if (existing) return;

    await db.auditLog.create({
        data: {
            actorKind: "system",
            actorId: "circle-webhook",
            action: `circle.${payload.notificationType}`,
            targetKind: "circle_notification",
            targetId: payload.notificationId,
            payloadJsonb: payload as unknown as object,
        },
    });

    if (payload.notificationType === "contracts.events.created") {
        await routeContractEvent(
            payload.notification as unknown as ContractEventNotification,
        );
    }
}
