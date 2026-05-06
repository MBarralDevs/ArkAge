import { db } from "@/lib/db";

/**
 * Shape of a Circle Contract Platform webhook payload for contract
 * events. Other Circle webhook event types (wallets.transaction.created,
 * wallets.transaction.updated, etc.) are silently ignored at this layer
 * — we only normalize on-chain contract events here.
 */
export interface CircleWebhookPayload {
    eventType: string;
    data: {
        contractAddress: string;
        eventName: string;
        txHash: string;
        logIndex: number;
        blockNumber: string;
        blockTime: string;
        params: Record<string, unknown>;
    };
}

/**
 * Land a Circle Contract Platform contract-event webhook in `audit_log`.
 *
 * Plan A's job is end-to-end delivery — once we see contract events
 * arriving here we know the chain → Circle → ArkAge pipeline is live.
 * Plan B will branch off this entry point to dispatch into specific
 * domain tables (jobs, reputation_feedback, etc.) and fire workflow
 * resumeHooks; for now everything funnels into audit_log and the
 * stuck-workflow reconciler picks up any drops.
 */
export async function ingestCircleEvent(payload: CircleWebhookPayload): Promise<void> {
    if (payload.eventType !== "contracts.event") {
        return;
    }

    const { data } = payload;

    await db.auditLog.create({
        data: {
            actorKind: "system",
            actorId: "circle-webhook",
            action: `chain.${data.eventName}`,
            targetKind: "contract",
            targetId: data.contractAddress,
            payloadJsonb: data as unknown as object,
        },
    });
}
