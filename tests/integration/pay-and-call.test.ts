import { describe, it, expect, vi } from "vitest";
import { handlePayAndCall } from "@/mcp/tools/x402/pay-and-call";

vi.mock("@/lib/x402-buyer", () => ({
    gatewayClientForAgent: vi.fn(() => ({})),
    payAndCall: vi.fn(async () => ({
        status: 200,
        body: { ok: true, payload: "hello" },
        paymentSignature: ("0x" + "ab".repeat(32)) as `0x${string}`,
        amountPaid: 1000n,
        sellerAddress:
            "0x2222000000000000000000000000000000000002" as `0x${string}`,
        paymentResponseHeader: "scheme=gateway_batched; tx=null",
        facilitatorTxHash: null,
    })),
}));

vi.mock("@/lib/x402-session-manager", () => ({
    openOrJoinSession: vi.fn(async () => ({
        sessionDbId: 1n,
        runId: "test-run",
        openedNew: true,
    })),
    bumpSessionActivity: vi.fn(async () => undefined),
}));

vi.mock("@/lib/x402-receipt-store", () => ({
    recordReceiptForSession: vi.fn(async () => ({
        receiptDbId: 7n,
        seq: 1,
    })),
}));

vi.mock("@/lib/agent-loader", () => ({
    loadAgentByDbId: vi.fn(async () => ({
        dbId: 1n,
        agentId: 100n,
        operatorWallet: "0x1111000000000000000000000000000000000001",
        identityOwner: "0x9999000000000000000000000000000000000009",
        active: true,
        tier2Kind: "circle-dcw-eoa",
        policy: {
            schemaVersion: 1,
            agentId: "100",
            version: 1,
            validFrom: 0,
            validTo: null,
            spendCaps: {
                perTx: "10000",
                perDay: "100000",
                perWeek: "700000",
            },
            allowedContracts: [],
            allowedSelectors: [],
            counterpartyRules: {
                minReputation: null,
                allowList: [],
                denyList: [],
            },
            rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 60 },
            tokens: ["0x3600000000000000000000000000000000000000"],
            evaluatorPreferences: {
                defaultTier: "standard",
                maxFeePerJob: "1000000",
            },
        },
        perTxCap: 10000n,
    })),
}));

vi.mock("@/lib/policy-engine", () => ({
    evaluatePolicy: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/db", () => {
    const wallet = {
        id: 42n,
        circleWalletId: "wlt_123",
        address: Buffer.from(
            "1111000000000000000000000000000000000001",
            "hex",
        ),
    };
    return {
        db: {
            wallet: {
                findUniqueOrThrow: vi.fn(async () => wallet),
                findUnique: vi.fn(async () => null),
            },
            agent: { findFirst: vi.fn(async () => null) },
            x402Endpoint: { findUnique: vi.fn(async () => null) },
        },
    };
});

describe("pay_and_call", () => {
    it("returns body, receipt id, session id when payment succeeds (seller is registered)", async () => {
        // Stage the env var the tool reads to derive the testnet EOA key.
        process.env.ARKAGE_TIER2_KEY_42 = ("0x" + "11".repeat(32)) as string;

        const { db } = await import("@/lib/db");
        // URL points at our own arkage-proxy → tool resolves endpoint
        // by id from x402Endpoint.findUnique. Mock it to return a
        // seller mapping so canPersistReceipt is satisfied.
        (
            db.x402Endpoint.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce({
            id: 5n,
            sellerAgentId: 200n,
        });

        const result = await handlePayAndCall(
            {
                asAgent: "1",
                url: "https://arkage.network/api/x402-proxy/5",
                maxPrice: "5000",
                idempotencyKey: "pc-1",
            },
            {
                token: "arkage_" + "0".repeat(64),
                builderId: 1n,
                actingAgentId: 1n,
                actingWalletAddress:
                    "0x1111000000000000000000000000000000000001",
            },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.status).toBe(200);
            expect(result.data.amountPaid).toBe("1000");
            expect(result.data.receiptId).toBe("7");
            expect(result.data.sessionId).toBe("1");
        }
    });

    it("returns circle_agent_wallet_run_locally envelope for Circle Agent Wallet-backed agents", async () => {
        const loaderMod = await import("@/lib/agent-loader");
        (
            loaderMod.loadAgentByDbId as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce({
            dbId: 1n,
            agentId: 100n,
            operatorWallet: "0x86f97b7afc0b580d342e824084b79ae89993ee77",
            identityOwner: "0x9999000000000000000000000000000000000009",
            active: true,
            tier2Kind: "circle-agent-wallet",
            policy: {
                schemaVersion: 1,
                agentId: "100",
                version: 1,
                validFrom: 0,
                validTo: null,
                spendCaps: { perTx: "10000", perDay: "100000", perWeek: "700000" },
                allowedContracts: [],
                allowedSelectors: [],
                counterpartyRules: {
                    minReputation: null,
                    allowList: [],
                    denyList: [],
                },
                rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 60 },
                tokens: ["0x3600000000000000000000000000000000000000"],
                evaluatorPreferences: {
                    defaultTier: "standard",
                    maxFeePerJob: "1000000",
                },
            },
            perTxCap: 10000n,
        });

        const result = await handlePayAndCall(
            {
                asAgent: "1",
                url: "https://arkage-zeta.vercel.app/api/x402-proxy/2",
                maxPrice: "5000",
                idempotencyKey: "pc-circle-1",
            },
            {
                token: "arkage_" + "0".repeat(64),
                builderId: 1n,
                actingAgentId: 1n,
                actingWalletAddress:
                    "0x86f97b7afc0b580d342e824084b79ae89993ee77",
            },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("circle_agent_wallet_run_locally");
            expect(result.message).toMatch(/circle services pay/);
            expect(result.message).toMatch(/ARC-TESTNET/);
            expect(result.message).toMatch(
                /0x86f97b7afc0b580d342e824084b79ae89993ee77/,
            );
        }
    });
});
