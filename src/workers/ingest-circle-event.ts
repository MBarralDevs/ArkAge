import { db } from "@/lib/db";

/**
 * Shape of a Circle Web3 Services / Smart Contract Platform webhook
 * notification. Every Circle webhook is wrapped in this envelope:
 *
 *   {
 *     subscriptionId, notificationId, notificationType,
 *     notification: { ...product-specific payload... },
 *     timestamp, version
 *   }
 *
 * `notificationType` examples we expect:
 *   - "webhooks.test"  — verification ping fired by Circle when
 *                        the webhook is created or "Retry connection"
 *                        is clicked
 *   - "contracts.events.created"  — a contract event was indexed by
 *                        Circle's event monitor (Smart Contract Platform)
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
 * Record an inbound Circle webhook notification in audit_log so we can
 * verify end-to-end delivery. Plan B will branch off this entry point
 * to dispatch into specific domain tables (jobs, reputation_feedback,
 * etc.) and fire workflow resumeHooks.
 *
 * Idempotent on (notificationId): a duplicate redelivery will be a no-op.
 */
export async function ingestCircleEvent(payload: CircleNotificationEnvelope): Promise<void> {
    // De-dupe via the unique notificationId Circle assigns per delivery.
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
}
