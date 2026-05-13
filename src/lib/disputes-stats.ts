import { db } from "./db";

/**
 * Plan E.1 (phase 1) — surface dispute history on agent profiles +
 * service cards. The workflow (`x402DisputeFlow`) already runs; today the
 * data is only visible in the admin view. Builders, counterparties, and
 * the public catalog all benefit from seeing it.
 *
 * The aggregator pulls every dispute where the given agent was either
 * the buyer or the seller on the underlying x402 session, plus a small
 * rollup by status + role. No N+1 — one query per agent thanks to the
 * Receipt → Session join Prisma can do in a single include tree.
 */

export type DisputeStatus =
    | "open"
    | "resolved_refund"
    | "resolved_no_refund"
    | "manual_review";

export interface DisputeRow {
    id: string;
    receiptId: string;
    sessionId: string;
    /** "buyer" if this agent raised the dispute, "seller" if they're the target. */
    role: "buyer" | "seller";
    counterpartyAgentId: string;
    reason: string;
    status: DisputeStatus;
    amount: string;
    resolutionTxHex: string | null;
    raisedAt: string;
    resolvedAt: string | null;
}

export interface DisputesStats {
    total: number;
    open: number;
    resolvedRefund: number;
    resolvedNoRefund: number;
    manualReview: number;
    asBuyer: number;
    asSeller: number;
    recent: DisputeRow[];
}

const RECENT_LIMIT = 10;

export async function loadAgentDisputes(
    agentDbId: bigint,
): Promise<DisputesStats> {
    const disputes = await db.x402Dispute.findMany({
        where: {
            OR: [
                { receipt: { session: { buyerAgentId: agentDbId } } },
                { receipt: { session: { sellerAgentId: agentDbId } } },
            ],
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
            receipt: {
                include: {
                    session: {
                        include: {
                            buyerAgent: { select: { id: true, agentId: true } },
                            sellerAgent: {
                                select: { id: true, agentId: true },
                            },
                        },
                    },
                },
            },
        },
    });

    const rollup: DisputesStats = {
        total: disputes.length,
        open: 0,
        resolvedRefund: 0,
        resolvedNoRefund: 0,
        manualReview: 0,
        asBuyer: 0,
        asSeller: 0,
        recent: [],
    };

    for (const d of disputes) {
        switch (d.status as DisputeStatus) {
            case "open":
                rollup.open++;
                break;
            case "resolved_refund":
                rollup.resolvedRefund++;
                break;
            case "resolved_no_refund":
                rollup.resolvedNoRefund++;
                break;
            case "manual_review":
                rollup.manualReview++;
                break;
        }
        const session = d.receipt.session;
        const role: "buyer" | "seller" =
            session.buyerAgent.id === agentDbId ? "buyer" : "seller";
        if (role === "buyer") rollup.asBuyer++;
        else rollup.asSeller++;
    }

    rollup.recent = disputes.slice(0, RECENT_LIMIT).map((d) => {
        const session = d.receipt.session;
        const isBuyer = session.buyerAgent.id === agentDbId;
        const role: "buyer" | "seller" = isBuyer ? "buyer" : "seller";
        const counterpartyAgentId = isBuyer
            ? session.sellerAgent.agentId.toString()
            : session.buyerAgent.agentId.toString();
        return {
            id: d.id.toString(),
            receiptId: d.receiptId.toString(),
            sessionId: session.id.toString(),
            role,
            counterpartyAgentId,
            reason: d.reason,
            status: d.status as DisputeStatus,
            amount: d.receipt.amount.toString(),
            resolutionTxHex: d.resolutionTx
                ? "0x" + Buffer.from(d.resolutionTx).toString("hex")
                : null,
            raisedAt: d.createdAt.toISOString(),
            resolvedAt: d.resolvedAt?.toISOString() ?? null,
        };
    });

    return rollup;
}

const STATUS_LABEL: Record<DisputeStatus, string> = {
    open: "Open",
    resolved_refund: "Refunded",
    resolved_no_refund: "No refund",
    manual_review: "Manual review",
};

export function disputeStatusLabel(s: DisputeStatus): string {
    return STATUS_LABEL[s] ?? s;
}
