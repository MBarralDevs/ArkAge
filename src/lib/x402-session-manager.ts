import { db } from "./db";
import { start } from "workflow/api";
import { x402PaymentSession } from "@/workflows/x402-payment-session";

/**
 * Session lifecycle helpers used by `arkage:pay_and_call` and the
 * facilitator webhook receiver.
 *
 * `openOrJoinSession` reuses an open session for the (buyer, seller)
 * pair if one exists within the 30-min idle window. Otherwise it
 * spawns a fresh `x402PaymentSession` workflow run and pins the
 * session row to the workflow's runId so the dashboard can resolve
 * the live stream by sessionDbId.
 */

export interface SessionHandle {
    sessionDbId: bigint;
    runId: string;
    openedNew: boolean;
}

const REOPEN_AFTER_IDLE_MS = 30 * 60_000;

export async function openOrJoinSession(
    buyerAgentDbId: bigint,
    sellerAgentDbId: bigint,
): Promise<SessionHandle> {
    const existing = await db.x402Session.findFirst({
        where: {
            buyerAgentId: buyerAgentDbId,
            sellerAgentId: sellerAgentDbId,
            status: "open",
            lastActivityAt: {
                gt: new Date(Date.now() - REOPEN_AFTER_IDLE_MS),
            },
        },
        orderBy: { openedAt: "desc" },
    });
    if (existing) {
        return {
            sessionDbId: existing.id,
            runId: existing.workflowRunId,
            openedNew: false,
        };
    }

    const [buyerAgent, sellerAgent] = await Promise.all([
        db.agent.findUniqueOrThrow({ where: { id: buyerAgentDbId } }),
        db.agent.findUniqueOrThrow({ where: { id: sellerAgentDbId } }),
    ]);

    const run = await start(x402PaymentSession, [
        BigInt(buyerAgent.agentId.toString()),
        BigInt(sellerAgent.agentId.toString()),
    ]);

    const created = await db.x402Session.create({
        data: {
            buyerAgentId: buyerAgentDbId,
            sellerAgentId: sellerAgentDbId,
            workflowRunId: run.runId,
            status: "open",
            openedAt: new Date(),
            lastActivityAt: new Date(),
        },
    });
    return { sessionDbId: created.id, runId: run.runId, openedNew: true };
}

export async function bumpSessionActivity(
    sessionDbId: bigint,
): Promise<void> {
    await db.x402Session.update({
        where: { id: sessionDbId },
        data: { lastActivityAt: new Date() },
    });
}

export async function closeSession(
    sessionDbId: bigint,
    reason: "buyer_closed" | "idle_timeout" | "risk_gated",
): Promise<void> {
    await db.x402Session.update({
        where: { id: sessionDbId },
        data: {
            status: reason === "risk_gated" ? "risk_gated" : "closed",
            closedAt: new Date(),
        },
    });
}
