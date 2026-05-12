import type { Address } from "viem";
import { circleCli } from "./circle-cli";

/**
 * Higher-level helpers for working with Circle Agent Wallets, built on top
 * of the thin `circleCli` subprocess wrapper. Same runtime constraint:
 * these MUST only be called from a builder's machine / smoke script — never
 * from Vercel functions.
 *
 * Plan E1 Task 4.
 */

const ARC_TESTNET_CHAIN = "ARC-TESTNET";

interface WalletListResponse {
    wallets: Array<{
        type: string;
        address: string;
        blockchain: string;
        createDate: string;
    }>;
}

interface WalletStatusResponse {
    type: string;
    email: string;
    mainnet?: { tokenStatus: string; expiresIn: string };
    testnet?: { tokenStatus: string; expiresIn: string };
}

interface GatewayBalanceResponse {
    message: string;
    address: string;
    backingEOA: string;
    total: string;
    token: string;
    balances: Array<{ network: string; domain: number; balance: string }>;
}

interface WalletBalanceResponse {
    balances: Array<{
        amount: string;
        token: {
            name: string;
            symbol: string;
            blockchain: string;
            decimals: number;
            isNative: boolean;
        };
    }>;
}

export type VerifyResult =
    | {
          exists: true;
          /** SCA address (what we store as the wallet's primary address). */
          address: Address;
          /** MPC-controlled EOA that signs EIP-3009 authorizations. */
          backingEoa: Address;
          /** Email that owns the Circle CLI session for this wallet. */
          email: string;
          /** USDC balance reported by `circle wallet balance` (raw string). */
          balanceUsdcRaw: string;
          /** When the wallet was created in Circle's records. */
          createdAt: string;
      }
    | {
          exists: false;
          /** Why the wallet wasn't found / verified. */
          reason: string;
      };

/**
 * Verifies that `address` exists as an agent wallet on `chain`, fetches its
 * backing EOA, the email controlling the session, and the current USDC
 * balance. Returns `{exists: false}` with a reason if any step fails.
 *
 * The chain defaults to ARC-TESTNET because that's the only chain Plan E1
 * targets, but the helper accepts an override for future flexibility.
 */
export async function verifyCircleAgentWallet(
    address: Address,
    chain: string = ARC_TESTNET_CHAIN,
): Promise<VerifyResult> {
    const normalized = address.toLowerCase();

    try {
        const list = await circleCli<WalletListResponse>({
            args: ["wallet", "list", "--type", "agent", "--chain", chain],
        });
        const match = list.wallets.find(
            (w) => w.address.toLowerCase() === normalized,
        );
        if (!match) {
            return {
                exists: false,
                reason: `address ${address} not found in agent wallets on ${chain}`,
            };
        }

        const [status, gateway, balance] = await Promise.all([
            circleCli<WalletStatusResponse>({ args: ["wallet", "status"] }),
            circleCli<GatewayBalanceResponse>({
                args: ["gateway", "balance", "--address", address, "--chain", chain],
            }),
            circleCli<WalletBalanceResponse>({
                args: ["wallet", "balance", "--address", address, "--chain", chain],
            }),
        ]);

        const usdc = balance.balances.find(
            (b) => b.token.symbol === "USDC",
        );

        return {
            exists: true,
            address,
            backingEoa: gateway.backingEOA as Address,
            email: status.email,
            balanceUsdcRaw: usdc?.amount ?? "0",
            createdAt: match.createDate,
        };
    } catch (e) {
        return {
            exists: false,
            reason: e instanceof Error ? e.message : String(e),
        };
    }
}
