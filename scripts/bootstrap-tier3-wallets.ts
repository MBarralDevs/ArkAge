/**
 * Bootstrap script for Plan A Task 25 — provisions Tier 3 system wallets
 * on Arc Testnet using Circle's Developer-Controlled Wallets SDK, plus a
 * throwaway deployer EOA used only for the contract bootstrap broadcast.
 *
 * Why a throwaway deployer EOA?
 *
 *   Circle DCWs use 2-of-2 MPC; the private key is sharded between Circle
 *   and the user — there's no way to export a raw private key. Foundry's
 *   `forge script --private-key` flow needs a raw key. So for the testnet
 *   bootstrap we generate a one-shot deployer EOA locally, fund it from
 *   the Circle faucet, deploy with it, and discard. The 3 long-lived
 *   Tier 3 wallets (treasury / validator / gas-funder) stay on Circle DCW
 *   for runtime ops as the spec requires.
 *
 *   For mainnet, this throwaway path goes away — see CLAUDE.md "PRIVATE_KEY
 *   is testnet-only" and `docs/runbooks/contract-deploy.md`.
 *
 * Run with:
 *
 *   npx tsx scripts/bootstrap-tier3-wallets.ts
 *
 * Required env (from .env.local):
 *
 *   CIRCLE_API_KEY=
 *
 * Optional env:
 *
 *   CIRCLE_ENTITY_SECRET=  (set after first run; if unset and unregistered,
 *                            this script will generate + register a fresh
 *                            entity secret on your Circle account)
 */

import {
    initiateDeveloperControlledWalletsClient,
    registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BLOCKCHAIN = "ARC-TESTNET" as const; // chain id 5042002
const WALLET_SET_NAME = "arkage-testnet-system";
const WALLET_NAMES = ["arkage:treasury", "arkage:validator", "arkage:gas-funder"] as const;
const RECOVERY_DIR = resolve(process.cwd(), ".secrets");

function require_env(key: string): string {
    const v = process.env[key];
    if (!v || v.trim() === "") {
        console.error(`Missing required env var: ${key}`);
        console.error("Set it in .env.local and re-run via:");
        console.error("  npx dotenv -e .env.local -- tsx scripts/bootstrap-tier3-wallets.ts");
        process.exit(1);
    }
    return v.trim();
}

async function main() {
    const apiKey = require_env("CIRCLE_API_KEY");

    // ---------- Step 1: entity secret ----------
    let entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();

    if (!entitySecret) {
        console.log("\n=== Step 1: registering a fresh entity secret with Circle ===");
        console.log("(no CIRCLE_ENTITY_SECRET in env — generating a new one)");

        if (!existsSync(RECOVERY_DIR)) mkdirSync(RECOVERY_DIR, { recursive: true });

        // The SDK's generateEntitySecret() prints to console rather than
        // returning the value, so we generate the 32-byte secret directly
        // (per Circle's docs: "a randomly generated 32-byte private key").
        entitySecret = randomBytes(32).toString("hex");

        await registerEntitySecretCiphertext({
            apiKey,
            entitySecret,
            recoveryFileDownloadPath: RECOVERY_DIR,
        });

        console.log("Entity secret registered. Recovery file written to:", RECOVERY_DIR);
        console.log("\n⚠  CRITICAL — save this entity secret to .env.local now:");
        console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
        console.log("\nAlso back up the recovery file in .secrets/ to a password manager.");
        console.log("Losing both = permanent account lockout (no recovery path).");
    } else {
        console.log("=== Step 1: using existing CIRCLE_ENTITY_SECRET ===");
    }

    // ---------- Step 2: SDK client ----------
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

    // ---------- Step 3: wallet set ----------
    console.log(`\n=== Step 2: creating wallet set "${WALLET_SET_NAME}" ===`);
    const setResp = await client.createWalletSet({ name: WALLET_SET_NAME });
    const walletSet = setResp.data?.walletSet;
    if (!walletSet?.id) {
        console.error("Failed to create wallet set:", setResp);
        process.exit(1);
    }
    console.log("Wallet set id:", walletSet.id);

    // ---------- Step 4: 3 EOA wallets on Arc Testnet ----------
    console.log(`\n=== Step 3: creating ${WALLET_NAMES.length} EOA wallets on ${BLOCKCHAIN} ===`);
    const walletsResp = await client.createWallets({
        walletSetId: walletSet.id,
        blockchains: [BLOCKCHAIN],
        accountType: "EOA",
        count: WALLET_NAMES.length,
        metadata: WALLET_NAMES.map((name) => ({ name })),
    });

    const wallets = walletsResp.data?.wallets ?? [];
    if (wallets.length !== WALLET_NAMES.length) {
        console.error(`Expected ${WALLET_NAMES.length} wallets, got ${wallets.length}`);
        console.error(JSON.stringify(walletsResp, null, 2));
        process.exit(1);
    }

    // Circle returns wallets in creation order, which matches our metadata array.
    const tier3 = WALLET_NAMES.map((name, i) => ({
        name,
        id: wallets[i]!.id,
        address: wallets[i]!.address,
    }));

    // ---------- Step 5: throwaway deployer EOA ----------
    console.log("\n=== Step 4: generating throwaway deployer EOA (testnet only) ===");
    const deployerKey = generatePrivateKey();
    const deployerAddress = privateKeyToAccount(deployerKey).address;

    // ---------- Step 6: emit summary the user pastes into .env.local ----------
    console.log("\n========================================================");
    console.log("DONE. Paste the following into .env.local (do NOT commit):");
    console.log("========================================================\n");
    for (const w of tier3) {
        const envName =
            w.name === "arkage:treasury"
                ? "ARKAGE_TREASURY_WALLET_ADDRESS"
                : w.name === "arkage:validator"
                  ? "ARKAGE_VALIDATOR_WALLET_ADDRESS"
                  : "ARKAGE_GAS_FUNDER_WALLET_ADDRESS";
        console.log(`# ${w.name} — Circle DCW id=${w.id}`);
        console.log(`${envName}=${w.address}`);
    }
    console.log("");
    console.log("# Throwaway deployer EOA — testnet only, discarded after Plan A");
    console.log(`PRIVATE_KEY=${deployerKey}`);
    console.log(`# (deployer address: ${deployerAddress})`);

    if (!process.env.CIRCLE_ENTITY_SECRET?.trim()) {
        console.log("");
        console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
    }

    console.log("\n========================================================");
    console.log("NEXT STEPS:");
    console.log("========================================================");
    console.log("1. Paste the lines above into .env.local");
    console.log("2. Visit https://faucet.circle.com — select Arc Testnet —");
    console.log(`   request USDC for the deployer address: ${deployerAddress}`);
    console.log("3. Run Task 26 (the deploy):");
    console.log("     cd contracts && \\");
    console.log("       export ARKAGE_TREASURY_WALLET_ADDRESS=...  # paste from .env.local");
    console.log("       export PRIVATE_KEY=...                      # paste from .env.local");
    console.log("       forge script script/Deploy.s.sol \\");
    console.log("         --rpc-url arc_testnet --private-key \"$PRIVATE_KEY\" \\");
    console.log("         --broadcast --verify --verifier blockscout \\");
    console.log("         --verifier-url https://testnet.arcscan.app/api -vvv");
}

main().catch((err) => {
    console.error("\n!! Bootstrap failed:");
    console.error(err);
    process.exit(1);
});
