import { db } from "./db";
import type { DisputeStatus } from "./disputes-stats";

/**
 * Plan E.1 phase 2.1 — full-detail loader for `/disputes/[id]`.
 *
 * Aggregates the dispute row + linked receipt + session + workflow run into
 * one shape the public timeline page renders. Public-facing: no auth check,
 * because exposing disputes is the whole trust-layer pitch — anyone can see
 * what's happening to whom.
 */

export interface DisputeDetail {
    id: string;
    status: DisputeStatus;
    reason: string;
    evidence: unknown | null;
    raisedAt: string;
    resolvedAt: string | null;
    raisedByWallet: string;
    /** When phase 2.2 ships, this will surface what the counter-party submitted. */
    counterpartyResponse: unknown | null;
    counterpartyRespondedAt: string | null;
    receipt: {
        id: string;
        url: string;
        amount: string;
        httpStatus: number | null;
        facilitatorProcessedAt: string;
        buyerWallet: string;
        sellerWallet: string;
    };
    session: {
        id: string;
        buyerAgentId: string;
        sellerAgentId: string;
        openedAt: string;
    };
    workflow: {
        runId: string;
        status: string;
        startedAt: string;
        lastAdvancedAt: string;
        completedAt: string | null;
        error: string | null;
    } | null;
}

export async function loadDisputeDetail(
    disputeDbId: bigint,
): Promise<DisputeDetail | null> {
    const dispute = await db.x402Dispute.findUnique({
        where: { id: disputeDbId },
        include: {
            receipt: {
                include: {
                    endpoint: true,
                    session: {
                        include: {
                            buyerAgent: { select: { agentId: true } },
                            sellerAgent: { select: { agentId: true } },
                        },
                    },
                },
            },
        },
    });
    if (!dispute) return null;

    const workflowRun = dispute.workflowRunId
        ? await db.workflowRun.findUnique({
              where: { runId: dispute.workflowRunId },
          })
        : null;

    return {
        id: dispute.id.toString(),
        status: dispute.status as DisputeStatus,
        reason: dispute.reason,
        evidence: dispute.evidenceJsonb ?? null,
        raisedAt: dispute.createdAt.toISOString(),
        resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
        raisedByWallet:
            "0x" + Buffer.from(dispute.raisedByWallet).toString("hex"),
        counterpartyResponse: dispute.counterpartyResponseJsonb ?? null,
        counterpartyRespondedAt:
            dispute.counterpartyRespondedAt?.toISOString() ?? null,
        receipt: {
            id: dispute.receipt.id.toString(),
            url: dispute.receipt.endpoint.effectiveUrl,
            amount: dispute.receipt.amount.toString(),
            httpStatus: dispute.receipt.httpStatus,
            facilitatorProcessedAt:
                dispute.receipt.facilitatorProcessedAt.toISOString(),
            buyerWallet:
                "0x" + Buffer.from(dispute.receipt.buyerWallet).toString("hex"),
            sellerWallet:
                "0x" +
                Buffer.from(dispute.receipt.sellerWallet).toString("hex"),
        },
        session: {
            id: dispute.receipt.session.id.toString(),
            buyerAgentId:
                dispute.receipt.session.buyerAgent.agentId.toString(),
            sellerAgentId:
                dispute.receipt.session.sellerAgent.agentId.toString(),
            openedAt: dispute.receipt.session.openedAt.toISOString(),
        },
        workflow: workflowRun
            ? {
                  runId: workflowRun.runId,
                  status: workflowRun.status,
                  startedAt: workflowRun.startedAt.toISOString(),
                  lastAdvancedAt: workflowRun.lastAdvancedAt.toISOString(),
                  completedAt: workflowRun.completedAt?.toISOString() ?? null,
                  error: workflowRun.error,
              }
            : null,
    };
}
