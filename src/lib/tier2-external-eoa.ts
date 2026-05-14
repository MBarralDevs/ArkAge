import {
    createWalletClient,
    http,
    type Address,
    type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./chain";
import { env } from "./env";

/**
 * Tier 2 = External EOA (bring-your-own).
 *
 * The router routes here when `wallets.custody = 'external-eoa'`. The
 * signing key is staged out-of-band as `ARKAGE_TIER2_KEY_<walletId>` —
 * the same env-var convention as the x402 EIP-3009 path in
 * `pay-and-call.ts` and `gateway-deposit.ts`. Testnet-only; v1.5
 * graduates external-EOA builders to Circle Agent Wallets, which sign
 * via the local `circle` CLI rather than a server-staged key.
 *
 * Returns the DCW-compatible queued-tx shape so handlers don't have to
 * branch on which signing path produced the receipt. `transactionId` is
 * the on-chain txHash (already broadcast), `state` is `"SENT"`.
 */
export interface QueuedEoaTx {
    transactionId: string;
    state: string;
}

export async function signWithTier2ExternalEoa(args: {
    walletDbId: bigint;
    to: Address;
    data: Hex;
}): Promise<QueuedEoaTx> {
    const pk = process.env[`ARKAGE_TIER2_KEY_${args.walletDbId}`] as
        | Hex
        | undefined;
    if (!pk) {
        throw new Error(
            `external-eoa signing key missing: ARKAGE_TIER2_KEY_${args.walletDbId}`,
        );
    }

    const account = privateKeyToAccount(pk);
    const client = createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(env.ARC_TESTNET_RPC_HTTP),
    });

    const txHash = await client.sendTransaction({
        to: args.to,
        data: args.data,
    });

    return { transactionId: txHash, state: "SENT" };
}
