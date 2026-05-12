import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
};
const publicClientMock = { getTransactionReceipt: vi.fn() };

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/chain", () => ({ publicClient: publicClientMock }));
vi.mock("@/lib/addresses", () => ({
    ARC_TESTNET_ADDRESSES: {
        ERC_8004_IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    },
    ARKAGE_ADDRESSES: {
        AGENT_REGISTRY: "0x06f606686016E5D015A4f0236307524E86E013e4",
    },
}));
vi.mock("@/lib/policy-canonical", () => ({
    hashPolicy: () => "0x" + "ab".repeat(32),
}));

const { handleCompleteOnchainRegistration } = await import(
    "@/mcp/tools/identity/complete-onchain-registration"
);

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 99n,
    actingAgentId: null,
    actingWalletAddress: "0xbbbb000000000000000000000000000000000bbb" as const,
};

const TX1 = ("0x" + "aa".repeat(32)) as `0x${string}`;
const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

const policyJson = {
    schemaVersion: 1,
    agentId: "100",
    version: 1,
    validFrom: 0,
    validTo: null,
    spendCaps: { perTx: "10000000", perDay: "100000000", perWeek: "700000000" },
    allowedContracts: [],
    allowedSelectors: [],
    counterpartyRules: { minReputation: null, allowList: [], denyList: [] },
    rateLimits: { jobsPerHour: 100, x402CallsPerMinute: 100 },
    tokens: ["0x3600000000000000000000000000000000000000"],
    evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
};

const baseAgent = {
    id: 100n,
    chainAgentId: null as bigint | null,
    currentOperatorWallet: {
        builderId: 99n,
        address: Buffer.from("11".repeat(20), "hex"),
    },
    policies: [{ bodyJsonb: policyJson }],
};

function mintReceipt(tokenIdHex: string) {
    return {
        status: "success" as const,
        logs: [
            {
                address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
                topics: [
                    TRANSFER_TOPIC,
                    ZERO_TOPIC,
                    "0x000000000000000000000000bbbb000000000000000000000000000000000bbb",
                    tokenIdHex,
                ],
            },
        ],
    };
}

describe("arkage:complete_onchain_registration", () => {
    beforeEach(() => {
        dbMock.agent.findUnique.mockReset();
        dbMock.agent.update.mockReset();
        dbMock.auditLog.create.mockReset();
        publicClientMock.getTransactionReceipt.mockReset();
    });

    it("captures the minted token id and returns Tx 2 envelope", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce(
            mintReceipt(
                "0x000000000000000000000000000000000000000000000000000000000000002a", // 42
            ),
        );

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-1",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok && result.data.state === "awaiting_tx2") {
            expect(result.data.chainAgentId).toBe("42");
            const tx = result.data.pendingActions[0]!.unsignedTx;
            expect(tx.to.toLowerCase()).toBe(
                "0x06f606686016e5d015a4f0236307524e86e013e4",
            );
            expect(tx.data.length).toBeGreaterThan(10);
        } else {
            throw new Error(`expected awaiting_tx2, got ${result.ok && result.data.state}`);
        }

        expect(dbMock.agent.update).toHaveBeenCalledOnce();
        const updateData = dbMock.agent.update.mock.calls[0]![0].data;
        expect(updateData.chainAgentId).toBe(42n);
    });

    it("returns tx1_pending when receipt fetch throws", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        publicClientMock.getTransactionReceipt.mockRejectedValueOnce(
            new Error("not mined yet"),
        );

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-2",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx1_pending");
        expect(dbMock.agent.update).not.toHaveBeenCalled();
    });

    it("returns tx1_no_mint when the receipt reverted", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce({
            status: "reverted",
            logs: [],
        });

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-3",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx1_no_mint");
    });

    it("returns tx1_no_mint when no Transfer event is found", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce(baseAgent);
        publicClientMock.getTransactionReceipt.mockResolvedValueOnce({
            status: "success",
            logs: [
                {
                    address: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
                    topics: [TRANSFER_TOPIC, ZERO_TOPIC, ZERO_TOPIC, "0x01"],
                },
            ],
        });

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-4",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("tx1_no_mint");
    });

    it("idempotency: returns Tx 2 envelope for an already-anchored agent without re-querying the receipt", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...baseAgent,
            chainAgentId: 99n,
        });

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-5",
            },
            ctx,
        );

        expect(result.ok && result.data.state).toBe("awaiting_tx2");
        if (result.ok && result.data.state === "awaiting_tx2") {
            expect(result.data.chainAgentId).toBe("99");
        }
        expect(publicClientMock.getTransactionReceipt).not.toHaveBeenCalled();
    });

    it("refuses when the agent isn't owned by the calling builder", async () => {
        dbMock.agent.findUnique.mockResolvedValueOnce({
            ...baseAgent,
            currentOperatorWallet: { ...baseAgent.currentOperatorWallet, builderId: 7n },
        });

        const result = await handleCompleteOnchainRegistration(
            {
                agentDbId: "100",
                identityRegisterTxHash: TX1,
                idempotencyKey: "comp-6",
            },
            ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("forbidden");
    });
});
