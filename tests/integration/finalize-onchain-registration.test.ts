import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
};
const publicClientMock = { getTransactionReceipt: vi.fn() };

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/chain", () => ({ publicClient: publicClientMock }));
vi.mock("@/lib/addresses", () => ({
    ARKAGE_ADDRESSES: {
        AGENT_REGISTRY: "0x06f606686016E5D015A4f0236307524E86E013e4",
    },
}));

const { handleFinalizeOnchainRegistration } = await import(
    "@/mcp/tools/identity/finalize-onchain-registration"
);

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 99n,
    actingAgentId: null,
    actingWalletAddress: "0xbbbb000000000000000000000000000000000bbb" as const,
};

const TX2 = ("0x" + "bb".repeat(32)) as `0x${string}`;

const anchoredAgent = {
    id: 100n,
    chainAgentId: 42n,
    agentRegistryTxHash: null as Buffer | null,
    currentOperatorWallet: { builderId: 99n },
};

describe("arkage:finalize_onchain_registration", () => {
    beforeEach(() => {
        dbMock.agent.findUnique.mockReset();
        dbMock.agent.update.mockReset();
        dbMock.auditLog.create.mockReset();
        publicClientMock.getTransactionReceipt.mockReset();
    });

    it("stamps onChainRegisteredAt and returns complete state on a successful Tx 2", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(anchoredAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce({
            status: "success",
            to: "0x06f606686016E5D015A4f0236307524E86E013e4",
            logs: [],
        });

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-1",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.state).toBe("complete");
            if (result.data.state === "complete") {
                expect(result.data.chainAgentId).toBe("42");
            }
        }
        const data = dbMock.agent.update.mock.calls[0]![0].data;
        expect(data.onChainRegisteredAt).toBeInstanceOf(Date);
        expect(data.agentRegistryTxHash).toBeInstanceOf(Buffer);
    });

    it("returns tx2_pending when receipt fetch throws", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(anchoredAgent);
        publicClientMock.getTransactionReceipt.mockRejectedValueOnce(
            new Error("not mined"),
        );

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-2",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx2_pending");
    });

    it("returns tx2_reverted on a reverted tx", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(anchoredAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce({
            status: "reverted",
            to: "0x06f606686016E5D015A4f0236307524E86E013e4",
            logs: [],
        });

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-3",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx2_reverted");
    });

    it("returns tx2_reverted when tx targeted the wrong contract", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(anchoredAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce({
            status: "success",
            to: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
            logs: [],
        });

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-4",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx2_reverted");
        if (result.ok && result.data.state === "tx2_reverted") {
            expect(result.data.reason).toMatch(/expected AgentRegistry/);
        }
    });

    it("refuses when chain anchor hasn't been recorded yet (Tx 1 incomplete)", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...anchoredAgent,
            chainAgentId: null,
        });

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-5",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("tx1_not_recorded");
    });

    it("idempotency: returns complete without re-fetching receipt when Tx 2 already recorded", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...anchoredAgent,
            agentRegistryTxHash: Buffer.alloc(32, 0xbb),
        });

        const result = await handleFinalizeOnchainRegistration(
            {
                agentDbId: "100",
                agentRegistryTxHash: TX2,
                idempotencyKey: "fin-6",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("complete");
        expect(publicClientMock.getTransactionReceipt).not.toHaveBeenCalled();
    });
});
