import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/addresses", () => ({
    ARC_TESTNET_ADDRESSES: {
        ERC_8004_IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    },
    ARKAGE_ADDRESSES: {
        AGENT_REGISTRY: "0x06f606686016E5D015A4f0236307524E86E013e4",
    },
}));

const { handleRegisterAgentOnchain } = await import(
    "@/mcp/tools/identity/register-agent-onchain"
);

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 99n,
    actingAgentId: null,
    actingWalletAddress: "0xbbbb000000000000000000000000000000000bbb" as const,
};

const baseAgent = {
    id: 100n,
    chainAgentId: null as bigint | null,
    currentOperatorWallet: { builderId: 99n },
};

describe("arkage:register_agent_onchain", () => {
    beforeEach(() => {
        dbMock.agent.findUnique.mockReset();
        dbMock.auditLog.create.mockReset();
    });

    it("returns Tx 1 envelope when the agent has no chain anchor yet", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        dbMock.auditLog.create.mockResolvedValueOnce({});

        const result = await handleRegisterAgentOnchain(
            { agentDbId: "100", idempotencyKey: "anchor-1" },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.state).toBe("awaiting_tx1");
            expect(result.data.metadataURI).toBe("inline://arkage/agent/100");
            expect(result.data.pendingActions).toHaveLength(1);
            const tx = result.data.pendingActions[0]!.unsignedTx;
            expect(tx.to.toLowerCase()).toBe(
                "0x8004a818bfb912233c491871b3d84c89a494bd9e",
            );
            expect(tx.data.startsWith("0xf2c298be")).toBe(true);
            expect(tx.value).toBe("0");
        }
    });

    it("respects an explicit metadataURI", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        const result = await handleRegisterAgentOnchain(
            {
                agentDbId: "100",
                metadataURI: "ipfs://Qmcustom",
                idempotencyKey: "anchor-2",
            },
            ctx,
        );
        expect(result.ok && result.data.metadataURI).toBe("ipfs://Qmcustom");
    });

    it("refuses when the agent is already on-chain anchored", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...baseAgent,
            chainAgentId: 42n,
        });
        const result = await handleRegisterAgentOnchain(
            { agentDbId: "100", idempotencyKey: "anchor-3" },
            ctx,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("already_anchored");
    });

    it("refuses when the agent belongs to a different builder", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...baseAgent,
            currentOperatorWallet: { builderId: 7n },
        });
        const result = await handleRegisterAgentOnchain(
            { agentDbId: "100", idempotencyKey: "anchor-4" },
            ctx,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("forbidden");
    });

    it("returns agent_not_found for unknown ids", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(null);
        const result = await handleRegisterAgentOnchain(
            { agentDbId: "999", idempotencyKey: "anchor-5" },
            ctx,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("agent_not_found");
    });
});
