import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    x402Dispute: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { handleRespondToDispute } = await import(
    "@/mcp/tools/x402/respond-to-dispute"
);

const SELLER = "0xdead000000000000000000000000000000001234" as const;
const NOT_SELLER = "0xbbbb000000000000000000000000000000000bbb" as const;
const BUYER = "0x172b7952b0f711b8b372410e81d51dcba7d4bb02" as const;

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 99n,
    actingAgentId: null,
    actingWalletAddress: SELLER as `0x${string}`,
};

function disputeRow(opts: {
    counterpartyRespondedAt?: Date | null;
} = {}) {
    return {
        id: 1n,
        receipt: {
            sellerWallet: Buffer.from(SELLER.slice(2), "hex"),
            buyerWallet: Buffer.from(BUYER.slice(2), "hex"),
        },
        counterpartyResponseJsonb: null,
        counterpartyRespondedAt: opts.counterpartyRespondedAt ?? null,
    };
}

describe("arkage:respond_to_dispute", () => {
    beforeEach(() => {
        dbMock.x402Dispute.findUnique.mockReset();
        dbMock.x402Dispute.update.mockReset();
        dbMock.auditLog.create.mockReset();
    });

    it("records a first-time response from the seller wallet", async () => {
        dbMock.x402Dispute.findUnique.mockResolvedValueOnce(disputeRow());
        dbMock.x402Dispute.update.mockResolvedValueOnce({ id: 1n });
        dbMock.auditLog.create.mockResolvedValueOnce({});

        const result = await handleRespondToDispute(
            {
                disputeId: "1",
                response: { reason: "delivered, see logs" },
                idempotencyKey: "resp-1",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.state).toBe("recorded");
            expect(result.data.disputeId).toBe("1");
        }
        const updateArgs = dbMock.x402Dispute.update.mock.calls[0]![0];
        expect(updateArgs.data.counterpartyResponseJsonb).toEqual({
            response: { reason: "delivered, see logs" },
        });
        expect(updateArgs.data.counterpartyRespondedAt).toBeInstanceOf(Date);
        expect(dbMock.auditLog.create).toHaveBeenCalledOnce();
    });

    it("stores an artifactHash when provided", async () => {
        dbMock.x402Dispute.findUnique.mockResolvedValueOnce(disputeRow());
        dbMock.x402Dispute.update.mockResolvedValueOnce({ id: 1n });
        dbMock.auditLog.create.mockResolvedValueOnce({});

        const hash = "0x" + "ab".repeat(32);
        await handleRespondToDispute(
            {
                disputeId: "1",
                response: { tag: "delivered" },
                artifactHash: hash,
                idempotencyKey: "resp-2",
            },
            ctx,
        );

        const jsonb =
            dbMock.x402Dispute.update.mock.calls[0]![0].data
                .counterpartyResponseJsonb;
        expect(jsonb.artifactHash).toBe(hash);
        expect(jsonb.response).toEqual({ tag: "delivered" });
    });

    it("rejects callers other than the receipt's seller wallet", async () => {
        dbMock.x402Dispute.findUnique.mockResolvedValueOnce(disputeRow());

        const result = await handleRespondToDispute(
            {
                disputeId: "1",
                response: { reason: "impostor" },
                idempotencyKey: "resp-3",
            },
            {
                ...ctx,
                actingWalletAddress: NOT_SELLER as `0x${string}`,
            },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("not_authorized");
        expect(dbMock.x402Dispute.update).not.toHaveBeenCalled();
    });

    it("idempotency: returns already_responded when the dispute already has a response", async () => {
        const respondedAt = new Date("2026-05-14T10:00:00Z");
        dbMock.x402Dispute.findUnique.mockResolvedValueOnce(
            disputeRow({ counterpartyRespondedAt: respondedAt }),
        );

        const result = await handleRespondToDispute(
            {
                disputeId: "1",
                response: { reason: "second attempt" },
                idempotencyKey: "resp-4",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.state).toBe("already_responded");
            expect(result.data.respondedAt).toBe(respondedAt.toISOString());
        }
        expect(dbMock.x402Dispute.update).not.toHaveBeenCalled();
    });

    it("returns not_found when the dispute id is unknown", async () => {
        dbMock.x402Dispute.findUnique.mockResolvedValueOnce(null);

        const result = await handleRespondToDispute(
            {
                disputeId: "9999",
                response: {},
                idempotencyKey: "resp-5",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("not_found");
    });

    it("rejects malformed input (missing disputeId)", async () => {
        const result = await handleRespondToDispute(
            {
                response: { reason: "no id" },
                idempotencyKey: "resp-6",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("validation_error");
        expect(dbMock.x402Dispute.findUnique).not.toHaveBeenCalled();
    });

    it("rejects malformed artifactHash", async () => {
        const result = await handleRespondToDispute(
            {
                disputeId: "1",
                response: {},
                artifactHash: "0xnothex",
                idempotencyKey: "resp-7",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("validation_error");
    });
});
