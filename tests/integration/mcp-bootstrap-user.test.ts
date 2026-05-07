import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// Mock the Tier 2 DCW provisioning at the SDK boundary. Plan A's bootstrap
// script tested live Circle calls — for this MCP integration test we only
// care about the orchestration shape, not the Circle round-trip. (The
// real Tier 2 provisioning is exercised end-to-end in the smoke test in
// Phase 14.)
vi.mock("@/lib/tier2-dcw", () => ({
    provisionTier2DcwForBuilder: vi.fn(async () => ({
        walletId: "test-wallet-id",
        address: "0x2222000000000000000000000000000000000002",
    })),
}));

import { handleBootstrapUser } from "@/mcp/tools/identity/bootstrap-user";

const TEST_BUILDER_HEX = "0x1111000000000000000000000000000000000001";
const TEST_BUILDER_BYTES = Buffer.from(TEST_BUILDER_HEX.slice(2), "hex");

const ctx = {
    token: "arkage_" + "0".repeat(64),
    builderId: 0n,
    actingAgentId: null,
    actingWalletAddress: TEST_BUILDER_HEX as `0x${string}`,
};

describe("bootstrap_user", () => {
    beforeEach(async () => {
        await db.builder.deleteMany({ where: { primaryWallet: TEST_BUILDER_BYTES } });
        await db.wallet.deleteMany({ where: { address: TEST_BUILDER_BYTES } });
        await db.auditLog.deleteMany({
            where: { actorKind: "builder", actorId: TEST_BUILDER_HEX, action: "bootstrap_user" },
        });
    });

    afterEach(async () => {
        await db.builder.deleteMany({ where: { primaryWallet: TEST_BUILDER_BYTES } });
        await db.wallet.deleteMany({ where: { address: TEST_BUILDER_BYTES } });
        await db.auditLog.deleteMany({
            where: { actorKind: "builder", actorId: TEST_BUILDER_HEX, action: "bootstrap_user" },
        });
    });

    it("creates builder + Tier 1 wallet record + Tier 2 wallet, returns identifiers and pending Tier 1 signature", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "passkey-builder+dcw-agent",
                agentMetadata: {
                    name: "TestAgent",
                    description: "x",
                    capabilities: [],
                    version: "0.1.0",
                },
                builderPrimaryWallet: TEST_BUILDER_HEX,
                displayName: "test-bootstrap-1",
                idempotencyKey: "boot-test-1",
            },
            ctx,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("result was not ok");

        expect(result.data.builderWalletAddress).toBe(TEST_BUILDER_HEX);
        expect(result.data.agentOperatorWallet).toBe(
            "0x2222000000000000000000000000000000000002",
        );
        expect(result.data.policyHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(result.data.policyVersion).toBe(1);
        expect(result.data.pendingActions.length).toBe(1);
        expect(result.data.pendingActions[0]?.reason).toBe("identity_op");

        // Side-effect verification
        const builder = await db.builder.findUnique({
            where: { primaryWallet: TEST_BUILDER_BYTES },
        });
        expect(builder).not.toBeNull();
        expect(builder?.displayName).toBe("test-bootstrap-1");

        const tier1 = await db.wallet.findUnique({ where: { address: TEST_BUILDER_BYTES } });
        expect(tier1).not.toBeNull();
        expect(tier1?.tier).toBe(1);
        expect(tier1?.custody).toBe("modular");

        const audit = await db.auditLog.findFirst({
            where: { actorKind: "builder", actorId: TEST_BUILDER_HEX, action: "bootstrap_user" },
        });
        expect(audit).not.toBeNull();
    });

    it("dcw-only mode skips Tier 1 wallet record and pendingActions", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "dcw-only",
                agentMetadata: {
                    name: "TestAgent",
                    description: "x",
                    capabilities: [],
                    version: "0.1.0",
                },
                builderPrimaryWallet: TEST_BUILDER_HEX,
                idempotencyKey: "boot-test-dcw-only",
            },
            ctx,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("not ok");

        expect(result.data.pendingActions.length).toBe(0);

        const tier1 = await db.wallet.findUnique({ where: { address: TEST_BUILDER_BYTES } });
        expect(tier1).toBeNull();
    });

    it("rejects malformed builderPrimaryWallet (validation error)", async () => {
        const result = await handleBootstrapUser(
            {
                mode: "passkey-builder+dcw-agent",
                agentMetadata: {
                    name: "TestAgent",
                    description: "x",
                    capabilities: [],
                    version: "0.1.0",
                },
                builderPrimaryWallet: "not-a-hex",
                idempotencyKey: "boot-test-bad",
            },
            ctx,
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("should have failed");
        expect(result.code).toBe("validation_error");
    });

    it("is idempotent: re-running upserts builder and skips duplicate Tier 1 wallet insert", async () => {
        const args = {
            mode: "passkey-builder+dcw-agent" as const,
            agentMetadata: {
                name: "TestAgent",
                description: "x",
                capabilities: [],
                version: "0.1.0",
            },
            builderPrimaryWallet: TEST_BUILDER_HEX,
            idempotencyKey: "boot-test-idempotent",
        };

        const a = await handleBootstrapUser(args, ctx);
        const b = await handleBootstrapUser(args, ctx);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);

        const builders = await db.builder.findMany({
            where: { primaryWallet: TEST_BUILDER_BYTES },
        });
        expect(builders.length).toBe(1);

        const wallets = await db.wallet.findMany({
            where: { address: TEST_BUILDER_BYTES },
        });
        expect(wallets.length).toBe(1);
    });
});
