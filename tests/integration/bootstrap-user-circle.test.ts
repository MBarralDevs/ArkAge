import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    builder: { upsert: vi.fn() },
    wallet: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/tier2-dcw", () => ({
    provisionTier2DcwForBuilder: vi.fn(async () => ({
        address: "0xdcc0000000000000000000000000000000000000",
        walletId: 50n,
    })),
    depositTier2ToGateway: vi.fn(async () => ({
        depositTxHash: "0xdeadbeef",
    })),
}));
vi.mock("@/lib/tier1-modular", () => ({
    registerTier1Wallet: vi.fn(async () => ({ id: 10n })),
}));
vi.mock("@/lib/policy-canonical", () => ({
    hashPolicy: () => "0x" + "11".repeat(32),
}));
vi.mock("@/lib/addresses", () => ({
    ARC_TESTNET_ADDRESSES: {
        ERC_8004_IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    },
}));

const { handleBootstrapUser } = await import(
    "@/mcp/tools/identity/bootstrap-user"
);
const { provisionTier2DcwForBuilder } = await import("@/lib/tier2-dcw");

const CIRCLE_SCA = "0x86f97b7afc0b580d342e824084b79ae89993ee77" as const;
const CIRCLE_EOA = "0x3d6341f4af5ac687e4acb392bbe4745876ad6231" as const;
const BUILDER_WALLET = "0xbbbb000000000000000000000000000000000bbb" as const;

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 1n,
    actingAgentId: null,
    actingWalletAddress: BUILDER_WALLET,
};

const agentMetadata = {
    name: "Test agent",
    description: "for tests",
    capabilities: ["test"],
    version: "1.0",
};

describe("arkage:bootstrap_user — circle-agent-wallet mode", () => {
    beforeEach(() => {
        Object.values(dbMock).forEach((m) =>
            Object.values(m).forEach((fn) => fn.mockReset()),
        );
        (provisionTier2DcwForBuilder as ReturnType<typeof vi.fn>).mockClear();
        dbMock.builder.upsert.mockResolvedValue({ id: 1n });
        dbMock.wallet.findUnique.mockResolvedValue(null);
        dbMock.wallet.create.mockResolvedValue({ id: 200n });
        dbMock.auditLog.create.mockResolvedValue({});
    });

    it("registers a Circle Agent Wallet as Tier 2 and skips DCW provisioning", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "passkey-builder+circle-agent-wallet",
                builderPrimaryWallet: BUILDER_WALLET,
                agentMetadata,
                idempotencyKey: "boot-1",
                circleAgentWallet: {
                    address: CIRCLE_SCA,
                    email: "dev@example.com",
                    backingEoa: CIRCLE_EOA,
                },
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.agentOperatorWallet).toBe(CIRCLE_SCA);
            expect(result.data.gatewayDepositTx).toBeNull();
            expect(result.data.instructions.length).toBeGreaterThan(0);
            expect(result.data.instructions[0]).toMatch(
                /circle gateway deposit.*ARC-TESTNET/,
            );
        }

        expect(provisionTier2DcwForBuilder).not.toHaveBeenCalled();
        const created = dbMock.wallet.create.mock.calls.find(
            (call) => call[0]?.data?.custody === "circle-agent-wallet",
        );
        expect(created).toBeDefined();
        expect(created![0].data.accountType).toBe("sca");
        expect(created![0].data.circleAgentWalletEmail).toBe("dev@example.com");
    });

    it("rejects circle-agent-wallet mode when the wallet object is missing", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "passkey-builder+circle-agent-wallet",
                builderPrimaryWallet: BUILDER_WALLET,
                agentMetadata,
                idempotencyKey: "boot-2",
                // circleAgentWallet missing on purpose
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("validation_error");
        }
        expect(provisionTier2DcwForBuilder).not.toHaveBeenCalled();
        expect(dbMock.wallet.create).not.toHaveBeenCalled();
    });

    it("legacy mode (passkey-builder+dcw-agent) still provisions a DCW", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "passkey-builder+dcw-agent",
                builderPrimaryWallet: BUILDER_WALLET,
                agentMetadata,
                idempotencyKey: "boot-3",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.agentOperatorWallet).toBe(
                "0xdcc0000000000000000000000000000000000000",
            );
            expect(result.data.instructions).toEqual([]);
        }
        expect(provisionTier2DcwForBuilder).toHaveBeenCalledOnce();
    });
});
