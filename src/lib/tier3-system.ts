import type { Address } from "viem";
import { env } from "./env.js";
import { getCircleDcwClient } from "./circle-clients.js";
import type { QueuedDcwTx } from "./tier2-dcw.js";

/**
 * Tier 3 = ArkAge system wallets. Three roles, all internal:
 *  - validator   — signs the off-chain evaluator settlement (complete/reject)
 *  - treasury    — receives evaluator fees; signs withdrawals to the team multisig
 *  - gas-funder  — tops up Tier 1/2 wallets with USDC for gas
 *
 * All three are Circle DCW EOAs created during Plan A's bootstrap.
 * Addresses are pinned in env (.env.local + Vercel production).
 */

export type Tier3Wallet = "validator" | "treasury" | "gas-funder";

export function getTier3Address(role: Tier3Wallet): Address {
    switch (role) {
        case "validator": {
            if (!env.ARKAGE_VALIDATOR_WALLET_ADDRESS) {
                throw new Error("ARKAGE_VALIDATOR_WALLET_ADDRESS not set");
            }
            return env.ARKAGE_VALIDATOR_WALLET_ADDRESS as Address;
        }
        case "treasury": {
            if (!env.ARKAGE_TREASURY_WALLET_ADDRESS) {
                throw new Error("ARKAGE_TREASURY_WALLET_ADDRESS not set");
            }
            return env.ARKAGE_TREASURY_WALLET_ADDRESS as Address;
        }
        case "gas-funder": {
            if (!env.ARKAGE_GAS_FUNDER_WALLET_ADDRESS) {
                throw new Error("ARKAGE_GAS_FUNDER_WALLET_ADDRESS not set");
            }
            return env.ARKAGE_GAS_FUNDER_WALLET_ADDRESS as Address;
        }
    }
}

/**
 * Submit a contract-execution transaction from a Tier 3 system wallet.
 *
 * Resolves the role's Circle wallet ID once and caches it on the
 * function instance — every Tier 3 call after the first is a single
 * Circle API hit (just `createContractExecutionTransaction`).
 *
 * Returns the queued tx (id + state); workflows polling for txHash
 * use `waitForTxHash` from tier2-dcw.ts (same SDK, same poll path).
 */
export async function signWithTier3(
    role: Tier3Wallet,
    to: Address,
    data: `0x${string}`,
): Promise<QueuedDcwTx> {
    const client = getCircleDcwClient();
    const walletId = await resolveTier3WalletId(role);

    const tx = await client.createContractExecutionTransaction({
        walletId,
        contractAddress: to,
        callData: data,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = tx.data?.id;
    const state = tx.data?.state;
    if (!id || !state) throw new Error(`Tier 3 ${role} signing returned no id/state`);
    return { transactionId: id, state };
}

const tier3WalletIdCache = new Map<Tier3Wallet, string>();

async function resolveTier3WalletId(role: Tier3Wallet): Promise<string> {
    const cached = tier3WalletIdCache.get(role);
    if (cached) return cached;

    const address = getTier3Address(role);
    const client = getCircleDcwClient();
    const wallets = await client.listWallets({ blockchain: "ARC-TESTNET" });
    const match = wallets.data?.wallets?.find(
        (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
    if (!match) {
        throw new Error(`Tier 3 ${role} wallet not found in Circle (address ${address})`);
    }
    tier3WalletIdCache.set(role, match.id);
    return match.id;
}

/** Test-only: clear the cache so a re-mocked Circle client is picked up. */
export function _resetTier3CacheForTesting(): void {
    tier3WalletIdCache.clear();
}
