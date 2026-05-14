/**
 * Smoke prep extension: register a SECOND agent whose operator wallet
 * differs from the buyer's, so x402 pay_and_call can target it without
 * Circle's facilitator rejecting `payer == payee` (`reason: self_transfer`).
 *
 * The seller's operator wallet here doesn't need a real private key —
 * for batched settlement Circle holds funds in its GatewayWallet
 * contract pending batch flush, so the recipient address is mainly
 * a routing label. We use a deterministic test address.
 *
 * Usage:
 *   npm run smoke:register-seller -- 0xSellerAddress [agentName]
 */

import { db } from "../src/lib/db";
import { hashPolicy, type AgentPolicy } from "../src/lib/policy-canonical";

async function main() {
    const addrArg = process.argv[2];
    const agentName = process.argv[3] ?? "smoke-x402-seller";
    if (!addrArg || !/^0x[a-fA-F0-9]{40}$/.test(addrArg)) {
        console.error(
            "Usage: npm run smoke:register-seller -- 0x<40-hex> [agentName]",
        );
        process.exit(1);
    }
    const address = addrArg.toLowerCase();
    const addressBytes = Buffer.from(address.slice(2), "hex");

    // 1) Wallet (no builderId — this is a synthetic seller, not tied to
    //    a builder identity for the smoke test).
    const wallet = await db.wallet.upsert({
        where: { address: addressBytes },
        update: { tier: 2, custody: "external-eoa", accountType: "eoa" },
        create: {
            address: addressBytes,
            tier: 2,
            custody: "external-eoa",
            accountType: "eoa",
            status: "active",
        },
    });

    // 2) Agent
    const syntheticAgentId = `${999_000 + Number(wallet.id)}`;
    const agent = await db.agent.upsert({
        where: { agentId: syntheticAgentId },
        update: { currentOperatorWalletId: wallet.id, active: true },
        create: {
            agentId: syntheticAgentId,
            identityOwnerWallet: addressBytes,
            currentOperatorWalletId: wallet.id,
            agentWalletAddress: addressBytes,
            registeredAtBlock: 0n,
            active: true,
        },
    });

    // 3) Permissive testnet policy
    const nowSec = Math.floor(Date.now() / 1000);
    const policy: AgentPolicy = {
        schemaVersion: 1,
        agentId: agent.agentId.toString(),
        version: 1,
        validFrom: nowSec,
        validTo: null,
        spendCaps: {
            perTx: "10000000",
            perDay: "100000000",
            perWeek: "700000000",
        },
        allowedContracts: [],
        allowedSelectors: [],
        counterpartyRules: {
            minReputation: null,
            allowList: [],
            denyList: [],
        },
        rateLimits: { jobsPerHour: 100, x402CallsPerMinute: 100 },
        tokens: ["0x3600000000000000000000000000000000000000"],
        evaluatorPreferences: {
            defaultTier: "standard",
            maxFeePerJob: "1000000",
        },
    };
    const canonicalHash = hashPolicy(policy);

    const existing = await db.policy.findFirst({
        where: { agentId: agent.id },
    });
    if (!existing) {
        const created = await db.policy.create({
            data: {
                agentId: agent.id,
                version: 1,
                bodyJsonb: policy as unknown as object,
                canonicalHash: Buffer.from(
                    canonicalHash.replace(/^0x/, ""),
                    "hex",
                ),
                validFrom: new Date(),
                authoredByWallet: addressBytes,
            },
        });
        await db.agent.update({
            where: { id: agent.id },
            data: { currentPolicyId: created.id },
        });
    }

    // 4) Metadata
    const existingMeta = await db.agentMetadata.findFirst({
        where: { agentId: agent.id },
    });
    if (!existingMeta) {
        await db.agentMetadata.create({
            data: {
                agentId: agent.id,
                metadataUri: `arkage://smoke/${agent.agentId}`,
                metadataJsonb: {
                    name: agentName,
                    description:
                        "External-EOA smoke seller (Plan D Phase B)",
                    capabilities: ["x402_seller"],
                    version: "v0.1",
                } as object,
            },
        });
    }

    console.log("");
    console.log("================================================");
    console.log("  walletId          :", wallet.id.toString());
    console.log("  walletAddress     :", address);
    console.log("  agentDbId         :", agent.id.toString());
    console.log("  agentId (chain)   :", agent.agentId.toString());
    console.log("================================================");
    console.log("");
    console.log("Now register an x402 endpoint for this seller via MCP:");
    console.log(
        '  arkage:register_x402_endpoint asAgent="' +
            agent.agentId.toString() +
            '" hosting="arkage-proxy" url="<upstream>"',
    );

    await db.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
