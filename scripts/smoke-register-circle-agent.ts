/**
 * Plan E1 smoke prep: register a Circle Agent Wallet (SCA) as Tier 2 for a
 * builder. Replaces `smoke-register-external-tier2.ts` for builders using
 * Circle Agent Wallets instead of bring-your-own-EOA + env-staged keys.
 *
 * What it does:
 *   1. Verifies the address via `circle wallet list` (must be a real
 *      auto-provisioned agent wallet on the requested chain)
 *   2. Captures the backing EOA via `circle gateway balance`
 *   3. Captures the controlling email via `circle wallet status`
 *   4. Upserts the wallet row with custody='circle-agent-wallet', sca
 *   5. Creates / reuses an Agent row + initial permissive policy
 *   6. Prints the next-step `circle services pay` command tailored to
 *      this wallet so the smoke can be completed end-to-end manually
 *
 * Usage:
 *   npm run smoke:register-circle-agent -- 0xBuilderTier1Wallet 0xSca [agentName]
 *
 * (the Tier 1 wallet identifies the existing Builder row; the SCA is the
 * Circle Agent Wallet address from `circle wallet list --type agent
 * --chain ARC-TESTNET`.)
 *
 * Idempotent: re-running with the same SCA returns the existing wallet +
 * agent rows.
 *
 * **Required prerequisite**: builder must have an active Circle CLI
 * session for the target chain — run `circle wallet login your@email.com
 * --type agent --testnet` first if you don't.
 */

import { db } from "../src/lib/db";
import { hashPolicy, type AgentPolicy } from "../src/lib/policy-canonical";
import { verifyCircleAgentWallet } from "../src/lib/circle-agent-wallet";
import type { Address } from "viem";

async function main() {
    const builderArg = process.argv[2];
    const scaArg = process.argv[3];
    const agentName = process.argv[4] ?? "circle-agent-smoke";

    if (
        !builderArg ||
        !scaArg ||
        !/^0x[a-fA-F0-9]{40}$/.test(builderArg) ||
        !/^0x[a-fA-F0-9]{40}$/.test(scaArg)
    ) {
        console.error(
            "Usage: npm run smoke:register-circle-agent -- 0xBuilderTier1Wallet 0xSca [agentName]",
        );
        process.exit(1);
    }

    const builderWallet = builderArg.toLowerCase();
    const sca = scaArg.toLowerCase() as Address;
    const builderBytes = Buffer.from(builderWallet.slice(2), "hex");
    const scaBytes = Buffer.from(sca.slice(2), "hex");

    const builder = await db.builder.findUnique({
        where: { primaryWallet: builderBytes },
    });
    if (!builder) {
        console.error(
            `No builder row for ${builderWallet}. Run \`npm run smoke:issue-token -- ${builderWallet}\` first.`,
        );
        process.exit(1);
    }

    console.log(`[1/5] Verifying ${sca} via Circle CLI...`);
    const verify = await verifyCircleAgentWallet(sca);
    if (!verify.exists) {
        console.error(`Circle CLI rejected the wallet: ${verify.reason}`);
        console.error(
            "Hint: make sure you ran `circle wallet login --type agent --testnet` and that the SCA appears in `circle wallet list --type agent --chain ARC-TESTNET --output json`.",
        );
        process.exit(1);
    }
    console.log(
        `      ok — backing EOA ${verify.backingEoa}, email ${verify.email}, USDC balance ${verify.balanceUsdcRaw}`,
    );

    const backingEoaBytes = Buffer.from(
        verify.backingEoa.toLowerCase().replace(/^0x/, ""),
        "hex",
    );

    console.log(`[2/5] Upserting wallet row...`);
    const wallet = await db.wallet.upsert({
        where: { address: scaBytes },
        update: {
            tier: 2,
            custody: "circle-agent-wallet",
            accountType: "sca",
            builderId: builder.id,
            circleAgentWalletEmail: verify.email,
            circleBackingEoa: backingEoaBytes,
            status: "active",
        },
        create: {
            address: scaBytes,
            tier: 2,
            custody: "circle-agent-wallet",
            accountType: "sca",
            builderId: builder.id,
            circleAgentWalletEmail: verify.email,
            circleBackingEoa: backingEoaBytes,
            status: "active",
        },
    });
    console.log(`      wallet id ${wallet.id}`);

    console.log(`[3/5] Upserting agent row...`);
    const syntheticAgentId = `${998_000 + Number(wallet.id)}`;
    const agent = await db.agent.upsert({
        where: { agentId: syntheticAgentId },
        update: {
            currentOperatorWalletId: wallet.id,
            active: true,
        },
        create: {
            agentId: syntheticAgentId,
            identityOwnerWallet: builderBytes,
            currentOperatorWalletId: wallet.id,
            agentWalletAddress: scaBytes,
            registeredAtBlock: 0n,
            active: true,
        },
    });
    console.log(`      agent id ${agent.id} (synthetic chain id ${syntheticAgentId})`);

    console.log(`[4/5] Ensuring policy is in place...`);
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
    if (!existingPolicy) {
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
                authoredByWallet: builderBytes,
            },
        });
        await db.agent.update({
            where: { id: agent.id },
            data: { currentPolicyId: created.id },
        });
        console.log(`      created policy id ${created.id}`);
    } else {
        console.log(`      reusing policy id ${existingPolicy.id}`);
    }

    console.log(`[5/5] Registration complete.\n`);
    console.log(`Agent metadata:`);
    console.log(`  - name:           ${agentName}`);
    console.log(`  - agent dbId:     ${agent.id}`);
    console.log(`  - SCA address:    ${sca}`);
    console.log(`  - backing EOA:    ${verify.backingEoa}`);
    console.log(`  - controlling em: ${verify.email}\n`);
    console.log(`To complete the x402 smoke, run on your machine (where the Circle CLI session lives):\n`);
    console.log(
        `  CIRCLE_ACCEPT_TERMS=1 circle gateway deposit --amount 1 --address ${sca} --chain ARC-TESTNET --method direct --output json`,
    );
    console.log(
        `  CIRCLE_ACCEPT_TERMS=1 circle services pay https://arkage-zeta.vercel.app/api/x402-proxy/2 --address ${sca} --chain ARC-TESTNET --max-amount 0.01 --output json\n`,
    );
    console.log(
        `Note: as of 2026-05-12, \`circle gateway deposit\` on ARC-TESTNET is broken in Circle CLI v0.0.1 (claims balance is 0 regardless). Bug filed with Circle. End-to-end pay-and-call settlement will work once they patch.`,
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
