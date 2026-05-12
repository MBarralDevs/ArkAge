import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    wallet: {
        findUnique: vi.fn(),
        create: vi.fn(),
    },
    auditLog: {
        create: vi.fn(),
    },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { handleRegisterAgentWallet } = await import(
    "@/mcp/tools/identity/register-agent-wallet"
);

const SCA = "0x86f97b7afc0b580d342e824084b79ae89993ee77" as const;
const BACKING_EOA = "0x3d6341f4af5ac687e4acb392bbe4745876ad6231" as const;
const OTHER_BUILDER_WALLET = "0xeeee000000000000000000000000000000000eee" as const;

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 99n,
    actingAgentId: null,
    actingWalletAddress: OTHER_BUILDER_WALLET,
};

describe("arkage:register_agent_wallet", () => {
    beforeEach(() => {
        dbMock.wallet.findUnique.mockReset();
        dbMock.wallet.create.mockReset();
        dbMock.auditLog.create.mockReset();
    });

    it("creates a circle-agent-wallet row with backing EOA + email", async () => {
        dbMock.wallet.findUnique.mockResolvedValueOnce(null);
        dbMock.wallet.create.mockResolvedValueOnce({ id: 200n });
        dbMock.auditLog.create.mockResolvedValueOnce({});

        const result = await handleRegisterAgentWallet(
            {
                kind: "circle-agent-wallet",
                address: SCA,
                circleAgentWalletEmail: "dev@example.com",
                circleBackingEoa: BACKING_EOA,
                idempotencyKey: "reg-1",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.walletId).toBe("200");
            expect(result.data.kind).toBe("circle-agent-wallet");
        }
        const created = dbMock.wallet.create.mock.calls[0]![0];
        expect(created.data.tier).toBe(2);
        expect(created.data.custody).toBe("circle-agent-wallet");
        expect(created.data.accountType).toBe("sca");
        expect(created.data.circleAgentWalletEmail).toBe("dev@example.com");
        expect(created.data.circleBackingEoa).toBeInstanceOf(Buffer);
    });

    it("rejects circle-agent-wallet when email is missing", async () => {
        const result = await handleRegisterAgentWallet(
            {
                kind: "circle-agent-wallet",
                address: SCA,
                circleBackingEoa: BACKING_EOA,
                idempotencyKey: "reg-2",
            },
            ctx,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("validation_error");
        }
        expect(dbMock.wallet.create).not.toHaveBeenCalled();
    });

    it("rejects circle-agent-wallet when backing EOA is missing", async () => {
        const result = await handleRegisterAgentWallet(
            {
                kind: "circle-agent-wallet",
                address: SCA,
                circleAgentWalletEmail: "dev@example.com",
                idempotencyKey: "reg-3",
            },
            ctx,
        );
        expect(result.ok).toBe(false);
        expect(dbMock.wallet.create).not.toHaveBeenCalled();
    });

    it("registers an external-eoa without requiring Circle metadata", async () => {
        dbMock.wallet.findUnique.mockResolvedValueOnce(null);
        dbMock.wallet.create.mockResolvedValueOnce({ id: 201n });
        dbMock.auditLog.create.mockResolvedValueOnce({});

        const result = await handleRegisterAgentWallet(
            {
                kind: "external-eoa",
                address: SCA,
                idempotencyKey: "reg-4",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        const created = dbMock.wallet.create.mock.calls[0]![0];
        expect(created.data.custody).toBe("external-eoa");
        expect(created.data.accountType).toBe("eoa");
        expect(created.data.circleAgentWalletEmail).toBeNull();
        expect(created.data.circleBackingEoa).toBeNull();
    });

    it("idempotency: returns existing wallet when already owned by the same builder", async () => {
        dbMock.wallet.findUnique.mockResolvedValueOnce({
            id: 200n,
            builderId: 99n,
        });

        const result = await handleRegisterAgentWallet(
            {
                kind: "circle-agent-wallet",
                address: SCA,
                circleAgentWalletEmail: "dev@example.com",
                circleBackingEoa: BACKING_EOA,
                idempotencyKey: "reg-5",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.walletId).toBe("200");
        expect(dbMock.wallet.create).not.toHaveBeenCalled();
    });

    it("conflict: refuses to register a wallet owned by a different builder", async () => {
        dbMock.wallet.findUnique.mockResolvedValueOnce({
            id: 300n,
            builderId: 7n, // not ctx.builderId
        });

        const result = await handleRegisterAgentWallet(
            {
                kind: "circle-agent-wallet",
                address: SCA,
                circleAgentWalletEmail: "dev@example.com",
                circleBackingEoa: BACKING_EOA,
                idempotencyKey: "reg-6",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("wallet_owned_by_other_builder");
        }
        expect(dbMock.wallet.create).not.toHaveBeenCalled();
    });
});
