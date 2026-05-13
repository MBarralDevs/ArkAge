import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    x402Dispute: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { loadAgentDisputes, disputeStatusLabel } = await import(
    "@/lib/disputes-stats"
);

const AGENT_ID = 100n;
const COUNTERPARTY_ID = 200n;

function dispute(
    id: bigint,
    status:
        | "open"
        | "resolved_refund"
        | "resolved_no_refund"
        | "manual_review",
    role: "buyer" | "seller",
    reason = "no response",
    daysAgo = 1,
) {
    const buyerAgent =
        role === "buyer"
            ? { id: AGENT_ID, agentId: 998071n }
            : { id: COUNTERPARTY_ID, agentId: 999069n };
    const sellerAgent =
        role === "seller"
            ? { id: AGENT_ID, agentId: 998071n }
            : { id: COUNTERPARTY_ID, agentId: 999070n };
    return {
        id,
        receiptId: id * 10n,
        reason,
        status,
        resolutionTx: null,
        createdAt: new Date(Date.now() - daysAgo * 86_400_000),
        resolvedAt: null,
        receipt: {
            amount: { toString: () => "1000" },
            session: {
                id: 1n,
                buyerAgent,
                sellerAgent,
            },
        },
    };
}

describe("loadAgentDisputes", () => {
    beforeEach(() => {
        dbMock.x402Dispute.findMany.mockReset();
    });

    it("returns zero-state when the agent has no disputes", async () => {
        dbMock.x402Dispute.findMany.mockResolvedValueOnce([]);
        const stats = await loadAgentDisputes(AGENT_ID);
        expect(stats).toEqual({
            total: 0,
            open: 0,
            resolvedRefund: 0,
            resolvedNoRefund: 0,
            manualReview: 0,
            asBuyer: 0,
            asSeller: 0,
            recent: [],
        });
    });

    it("rolls up status + role correctly across mixed disputes", async () => {
        dbMock.x402Dispute.findMany.mockResolvedValueOnce([
            dispute(1n, "open", "buyer"),
            dispute(2n, "open", "seller"),
            dispute(3n, "resolved_refund", "buyer"),
            dispute(4n, "resolved_no_refund", "seller"),
            dispute(5n, "manual_review", "buyer"),
        ]);

        const stats = await loadAgentDisputes(AGENT_ID);

        expect(stats.total).toBe(5);
        expect(stats.open).toBe(2);
        expect(stats.resolvedRefund).toBe(1);
        expect(stats.resolvedNoRefund).toBe(1);
        expect(stats.manualReview).toBe(1);
        expect(stats.asBuyer).toBe(3);
        expect(stats.asSeller).toBe(2);
    });

    it("populates recent[] with role + counterparty + status fields", async () => {
        dbMock.x402Dispute.findMany.mockResolvedValueOnce([
            dispute(7n, "open", "buyer", "wrong content type"),
        ]);

        const stats = await loadAgentDisputes(AGENT_ID);
        expect(stats.recent).toHaveLength(1);
        const row = stats.recent[0]!;
        expect(row.role).toBe("buyer");
        expect(row.status).toBe("open");
        expect(row.reason).toBe("wrong content type");
        expect(row.counterpartyAgentId).toBe("999070"); // seller's chain id
    });

    it("caps recent[] at 10 entries", async () => {
        const fifteen = Array.from({ length: 15 }, (_, i) =>
            dispute(BigInt(i + 1), "open", "buyer"),
        );
        dbMock.x402Dispute.findMany.mockResolvedValueOnce(fifteen);
        const stats = await loadAgentDisputes(AGENT_ID);
        expect(stats.total).toBe(15);
        expect(stats.recent).toHaveLength(10);
    });

    it("exposes human-readable status labels", () => {
        expect(disputeStatusLabel("open")).toBe("Open");
        expect(disputeStatusLabel("resolved_refund")).toBe("Refunded");
        expect(disputeStatusLabel("resolved_no_refund")).toBe("No refund");
        expect(disputeStatusLabel("manual_review")).toBe("Manual review");
    });
});
