/**
 * **DEPRECATED (Plan E1, 2026-05-12).** Prefer `smoke:register-circle-agent`
 * for new agents — it registers a Circle Agent Wallet SCA as Tier 2 with no
 * private-key staging anywhere on ArkAge's side. See:
 *   - `scripts/smoke-register-circle-agent.ts`
 *   - `docs/runbooks/circle-agent-wallet-onboarding.md`
 *
 * This script is kept only for v1 agents that already have an
 * `ARKAGE_TIER2_KEY_<walletId>` env var staged. New agents should NOT use
 * it. The env-staged-key path will be removed in v2.
 *
 * ---
 *
 * Smoke prep for Plan D Phase B: register a user-supplied EOA as a
 * Tier 2 wallet + create an `agents` row + initial policy in one go.
 *
 * Why this exists: `arkage:bootstrap_user` provisions a Circle DCW
 * (MPC, no exposed key), which works for ERC-8183 jobs but breaks
 * x402 `pay_and_call` because `GatewayClient` needs a raw EOA private
 * key (Plan D Task 1's documented testnet limitation, LBC-1).
 *
 * For the smoke test we register the user's regular EOA directly as
 * Tier 2. The private key is never read or transmitted by this
 * script — it just registers the public address. The user stages the
 * key separately as `ARKAGE_TIER2_KEY_<walletId>` on Vercel.
 *
 * Usage:
 *   npm run smoke:register-tier2 -- 0xYourEoaAddress [agentName]
 *
 * Idempotent: safe to re-run; will reuse an existing Tier 2 wallet
 * and agent rows for the same address + builder.
 */

import { db } from "../src/lib/db";
import { hashPolicy, type AgentPolicy } from "../src/lib/policy-canonical";

async function main() {
    const addrArg = process.argv[2];
    const agentName = process.argv[3] ?? "smoke-x402";
    if (!addrArg || !/^0x[a-fA-F0-9]{40}$/.test(addrArg)) {
        console.error(
            "Usage: npm run smoke:register-tier2 -- 0x<40-hex> [agentName]",
        );
        process.exit(1);
    }
    const address = addrArg.toLowerCase();
    const addressBytes = Buffer.from(address.slice(2), "hex");

    const builder = await db.builder.findUnique({
        where: { primaryWallet: addressBytes },
    });
    if (!builder) {
        console.error(
            `No builder row for ${address}. Run \`npm run smoke:issue-token -- ${address}\` first.`,
        );
        process.exit(1);
    }

    // 1) Wallet row (idempotent on the address)
    const wallet = await db.wallet.upsert({
        where: { address: addressBytes },
        update: {
            tier: 2,
            custody: "external-eoa",
            accountType: "eoa",
            builderId: builder.id,
            status: "active",
        },
        create: {
            address: addressBytes,
            tier: 2,
            custody: "external-eoa",
            accountType: "eoa",
            builderId: builder.id,
            status: "active",
        },
    });

    // 2) Agent row (uses a synthetic agentId since we're not registering on
    //    ERC-8004 IdentityRegistry on-chain for the smoke). We pick a
    //    unique agentId by appending the wallet's id to a prefix.
    const syntheticAgentId = `${999_000 + Number(wallet.id)}`;
    const agent = await db.agent.upsert({
        where: { agentId: syntheticAgentId },
        update: {
            currentOperatorWalletId: wallet.id,
            active: true,
        },
        create: {
            agentId: syntheticAgentId,
            identityOwnerWallet: addressBytes,
            currentOperatorWalletId: wallet.id,
            agentWalletAddress: addressBytes,
            registeredAtBlock: 0n,
            active: true,
        },
    });

    // 3) Policy (default permissive — testnet smoke only).
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

    const existingPolicy = await db.policy.findFirst({
        where: { agentId: agent.id },
        orderBy: { version: "desc" },
    });

    let policyId: bigint;
    if (existingPolicy) {
        policyId = existingPolicy.id;
    } else {
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
        policyId = created.id;
        await db.agent.update({
            where: { id: agent.id },
            data: { currentPolicyId: policyId },
        });
    }

    // 4) Optional metadata
    const existingMeta = await db.agentMetadata.findFirst({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
    });
    if (!existingMeta) {
        await db.agentMetadata.create({
            data: {
                agentId: agent.id,
                metadataUri: `arkage://smoke/${agent.agentId}`,
                metadataJsonb: {
                    name: agentName,
                    description: "External-EOA smoke agent (Plan D Phase B)",
                    capabilities: ["x402_pay"],
                    version: "v0.1",
                } as object,
            },
        });
    }

    console.log("");
    console.log("================================================");
    console.log("  builderId         :", builder.id.toString());
    console.log("  walletId          :", wallet.id.toString());
    console.log("  walletAddress     :", address);
    console.log("  agentDbId         :", agent.id.toString());
    console.log("  agentId (chain)   :", agent.agentId.toString());
    console.log("  policyVersion     :", 1);
    console.log("  policyHash        :", canonicalHash);
    console.log("================================================");
    console.log("");
    console.log("Next step (your terminal):");
    console.log(
        `  npx vercel env add ARKAGE_TIER2_KEY_${wallet.id} production`,
    );
    console.log(
        "  → paste your private key when prompted (it's read from stdin, not echoed)",
    );
    console.log("Then redeploy:");
    console.log("  npx vercel --prod");

    await db.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
