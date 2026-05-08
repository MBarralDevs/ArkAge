import type { Address } from "viem";
import { db } from "./db";
import { getCircleDcwClient } from "./circle-clients";

/**
 * Tier 2 = Agent's Circle DCW in EOA mode.
 *
 * Custodial within ArkAge policy. Used for runtime agent operations:
 * accepting jobs, submitting work, paying x402 invoices. EOA mode is
 * mandatory (LBC-1 in spec §5) — Circle Gateway nanopayments verify
 * via ecrecover and don't accept smart-account signatures.
 */

export interface ProvisionedTier2 {
    walletId: string;
    address: Address;
}

/**
 * Create a fresh Tier 2 DCW for a builder + persist the wallet row.
 *
 * One wallet set per builder (named `arkage-tier2-builder-<id>`) so
 * Circle's per-set quotas don't leak across builders. Wallet is created
 * on Arc Testnet in EOA mode and recorded in the `wallets` table with
 * tier=2, custody='dcw', accountType='eoa'.
 */
export async function provisionTier2DcwForBuilder(builderId: bigint): Promise<ProvisionedTier2> {
    const client = getCircleDcwClient();

    const setResp = await client.createWalletSet({
        name: `arkage-tier2-builder-${builderId}`,
    });
    const walletSetId = setResp.data?.walletSet?.id;
    if (!walletSetId) throw new Error("walletSet creation failed");

    const created = await client.createWallets({
        accountType: "EOA",
        blockchains: ["ARC-TESTNET"],
        count: 1,
        walletSetId,
    });

    const wallet = created.data?.wallets?.[0];
    if (!wallet) throw new Error("wallet creation failed");

    await db.wallet.create({
        data: {
            address: Buffer.from(wallet.address.replace(/^0x/, ""), "hex"),
            tier: 2,
            custody: "dcw",
            accountType: "eoa",
            builderId,
            circleWalletId: wallet.id,
            status: "active",
        },
    });

    return { walletId: wallet.id, address: wallet.address as Address };
}

/**
 * Submit a contract-execution transaction from a Tier 2 DCW.
 *
 * The Circle SDK accepts raw calldata via `callData`. The response is
 * the *queued* transaction (id + state) — Circle then signs and
 * broadcasts asynchronously. The on-chain `txHash` becomes available
 * via `getTransaction(id)` once the transaction reaches `SENT` state.
 *
 * Workflows that need the txHash should poll via `waitForTxHash`. Tools
 * that just need the queue ack can return the id directly.
 */
export interface QueuedDcwTx {
    transactionId: string;
    state: string;
}

export async function signWithTier2(
    walletId: string,
    to: Address,
    data: `0x${string}`,
): Promise<QueuedDcwTx> {
    const client = getCircleDcwClient();
    const tx = await client.createContractExecutionTransaction({
        walletId,
        contractAddress: to,
        callData: data,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = tx.data?.id;
    const state = tx.data?.state;
    if (!id || !state) throw new Error("createContractExecutionTransaction returned no id/state");
    return { transactionId: id, state };
}

/**
 * Poll a queued Circle transaction until it has a populated `txHash`.
 *
 * Returns the on-chain hash. Throws if the transaction reaches a
 * terminal failure state (FAILED, CANCELLED). Default timeout 60s with
 * 1.5s polling — plenty for Arc Testnet's sub-second finality.
 */
export async function waitForTxHash(
    transactionId: string,
    opts?: { timeoutMs?: number; pollMs?: number },
): Promise<`0x${string}`> {
    const client = getCircleDcwClient();
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const pollMs = opts?.pollMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const tx = await client.getTransaction({ id: transactionId });
        const txHash = tx.data?.transaction?.txHash;
        const state = tx.data?.transaction?.state;
        if (txHash) return txHash as `0x${string}`;
        if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
            throw new Error(`Tier 2 tx ${transactionId} reached terminal state ${state}`);
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`Tier 2 tx ${transactionId} timed out waiting for txHash`);
}
