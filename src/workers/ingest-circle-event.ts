import { db } from "@/lib/db";
import { resumeHook, start } from "workflow/api";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { CHAIN_ID as ARC_CHAIN_ID } from "@/lib/chain";
import {
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
} from "@/workflows/lib/hook-tokens";
import { jobLifecycle } from "@/workflows/job-lifecycle";

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
export interface ContractEventNotification {
    contractAddress: string;
    eventName: string;
    txHash: string;
    logIndex: number;
    blockNumber: string | number;
    blockTime: string;
    params: Record<string, unknown>;
}

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

/**
 * Land a JobCreated event into the `jobs` table. Idempotent — second
 * delivery is a no-op via Prisma `upsert`. Skips when the client or
 * (non-zero) provider isn't a known ArkAge agent — ERC-8183 is a shared
 * public protocol and we only track jobs whose client agent is in our
 * registry. The job_events row is still recorded against the on-chain
 * actor address so analytics can see foreign activity if needed.
 */
export async function handleJobCreated(
    data: ContractEventNotification,
): Promise<void> {
    const p = data.params as {
        jobId?: string;
        client?: string;
        provider?: string;
        evaluator?: string;
        expiredAt?: string;
        hook?: string;
    };
    if (!p.jobId || !p.client || !p.evaluator || !p.expiredAt) return;

    const clientBytes = bytesFromHex(p.client);
    const clientWallet = await db.wallet.findUnique({
        where: { address: clientBytes },
    });
    if (!clientWallet) return;
    const clientAgent = await db.agent.findFirst({
        where: { currentOperatorWalletId: clientWallet.id },
    });
    if (!clientAgent) return;

    let providerAgentId: bigint | null = null;
    if (
        p.provider &&
        p.provider.toLowerCase() !==
            "0x0000000000000000000000000000000000000000"
    ) {
        const providerWallet = await db.wallet.findUnique({
            where: { address: bytesFromHex(p.provider) },
        });
        if (providerWallet) {
            const a = await db.agent.findFirst({
                where: { currentOperatorWalletId: providerWallet.id },
            });
            providerAgentId = a?.id ?? null;
        }
    }

    const job = await db.job.upsert({
        where: { jobId: p.jobId },
        update: {},
        create: {
            jobId: p.jobId,
            clientAgentId: clientAgent.id,
            providerAgentId,
            evaluatorAddress: bytesFromHex(p.evaluator),
            status: "open",
            hookAddress: bytesFromHex(
                p.hook ?? "0x0000000000000000000000000000000000000000",
            ),
            expiredAt: new Date(Number(p.expiredAt) * 1000),
            createdAtBlock: BigInt(data.blockNumber),
        },
    });

    // Spawn the jobLifecycle workflow exactly once per jobId. It owns the
    // self-rescuing await chain (funded → submitted → evaluator child →
    // terminal). Idempotent via workflow_runs lookup so backfill and
    // replays from the cron don't multi-start.
    // `kind` must match the string jobLifecycle passes to
    // recordWorkflowStart ("job_lifecycle") — otherwise the idempotency
    // check never finds an existing run and every re-delivery of
    // JobCreated spawns a duplicate workflow. Only an active or
    // successful run blocks a spawn; a failed/cancelled run is treated
    // as re-spawnable so JobCreated re-delivery doubles as recovery.
    const existingRun = await db.workflowRun.findFirst({
        where: {
            kind: "job_lifecycle",
            kindId: BigInt(p.jobId),
            status: { in: ["running", "completed"] },
        },
        select: { runId: true },
    });
    if (!existingRun) {
        try {
            await start(jobLifecycle, [
                BigInt(p.jobId),
                Number(p.expiredAt),
            ]);
        } catch (e) {
            console.error(
                `[handleJobCreated] workflow start failed for jobId=${p.jobId}`,
                e instanceof Error ? e.message : String(e),
            );
        }
    }

    await db.jobEvent
        .upsert({
            where: {
                chainId_txHash_logIndex: {
                    chainId: ARC_CHAIN_ID,
                    txHash: bytesFromHex(data.txHash),
                    logIndex: data.logIndex,
                },
            },
            update: {},
            create: {
                jobId: job.id,
                eventKind: "created",
                actorAddress: clientBytes,
                payloadJsonb: data.params as object,
                chainId: ARC_CHAIN_ID,
                txHash: bytesFromHex(data.txHash),
                logIndex: data.logIndex,
                blockNumber: BigInt(data.blockNumber),
                blockTime: new Date(data.blockTime),
            },
        })
        .catch(() => {});
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
        const p = data.params as {
            actor?: string;
            funder?: string;
            provider?: string;
            evaluator?: string;
            amount?: string;
            reason?: string;
        };
        const actor =
            p.actor ?? p.funder ?? p.provider ?? p.evaluator ?? data.contractAddress;

        await db.jobEvent
            .upsert({
                where: {
                    chainId_txHash_logIndex: {
                        chainId: ARC_CHAIN_ID,
                        txHash: bytesFromHex(data.txHash),
                        logIndex: data.logIndex,
                    },
                },
                update: {},
                create: {
                    jobId: job.id,
                    eventKind,
                    actorAddress: bytesFromHex(actor),
                    payloadJsonb: data.params as object,
                    chainId: ARC_CHAIN_ID,
                    txHash: bytesFromHex(data.txHash),
                    logIndex: data.logIndex,
                    blockNumber: BigInt(data.blockNumber),
                    blockTime: new Date(data.blockTime),
                },
            })
            .catch(() => {});

        const order: Record<string, number> = {
            open: 0,
            funded: 1,
            submitted: 2,
            completed: 3,
            rejected: 3,
            expired: 3,
        };
        const cur = order[job.status] ?? 0;
        const next = order[eventKind] ?? 0;
        if (next > cur) {
            const update: Record<string, unknown> = { status: eventKind };
            if (eventKind === "funded" && p.amount) {
                update.budget = p.amount;
            }
            if ((eventKind === "completed" || eventKind === "rejected") && p.reason) {
                update.reasonHash = bytesFromHex(p.reason);
                update.completedAtBlock = BigInt(data.blockNumber);
            }
            await db.job.update({
                where: { id: job.id },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: update as any,
            });
        }
    }

    await resumeHook(tokenFn(jobId), data.params).catch(() => {
        // Hook may not exist when there's no live workflow listening for
        // this jobId (e.g., backfill of a foreign job, or no workflow ever
        // started). Treat as no-op — the JobEvent + status update above
        // still landed.
    });
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
        if (notification.eventName === "JobCreated") {
            await handleJobCreated(notification);
            return;
        }
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
