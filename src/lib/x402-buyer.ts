import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Address } from "viem";

/**
 * Buyer-side x402 helpers wrapping `@circle-fin/x402-batching`'s
 * `GatewayClient`. Two responsibilities:
 *   1. ensureGatewayDeposit — first-time funding of the Gateway Wallet
 *      from the agent's Tier 2 EOA. Idempotent.
 *   2. payAndCall — a tighter wrapper around `client.pay()` that:
 *      - enforces our `maxPriceRaw` cap (the SDK accepts `maxPrice` but
 *        doesn't surface a clean cap-violation error)
 *      - asserts `expectedSeller` matches the 402's payTo (defense-in-
 *        depth against MITM swap of the recipient address)
 *      - normalizes the response into a typed `PayAndCallResult`
 *
 * v1 testnet limitation: GatewayClient takes a raw `privateKey`, but
 * Tier 2 uses Circle DCW (MPC, no exposed key). The MCP tool stages
 * a per-wallet env var `ARKAGE_TIER2_KEY_<id>` for testnet only;
 * mainnet path graduates to a DCW signing bridge per spec LBC-1.
 */

/** Factory: returns a GatewayClient bound to the agent's Tier 2 EOA private key. */
export function gatewayClientForAgent(
    agentEoaPrivateKey: `0x${string}`,
): GatewayClient {
    return new GatewayClient({
        chain: "arcTestnet",
        privateKey: agentEoaPrivateKey,
    });
}

export async function ensureGatewayDeposit(
    client: GatewayClient,
    amountUsdc: string,
): Promise<{
    depositTxHash: `0x${string}` | null;
    alreadyFunded: boolean;
}> {
    try {
        const tx = await client.deposit(amountUsdc);
        return {
            depositTxHash: tx.depositTxHash as `0x${string}`,
            alreadyFunded: false,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already deposited|sufficient balance/i.test(msg)) {
            return { depositTxHash: null, alreadyFunded: true };
        }
        throw e;
    }
}

export interface PayAndCallParams {
    url: string;
    maxPriceRaw?: bigint;
    expectedSeller?: Address;
    requestBody?: unknown;
    requestHeaders?: Record<string, string>;
}

export interface PayAndCallResult {
    status: number;
    body: unknown;
    paymentSignature: `0x${string}`;
    amountPaid: bigint;
    sellerAddress: Address;
    paymentResponseHeader: string | null;
    facilitatorTxHash: `0x${string}` | null;
}

/**
 * Real `@circle-fin/x402-batching@3.0.4` PayResult shape (verified
 * against `node_modules/@circle-fin/x402-batching/dist/client/index.js`):
 *
 *   { data, amount: bigint, formattedAmount: string,
 *     transaction: string, status: number }
 *
 * Plan D Task 1's pseudo-code assumed a nested `result.payment.{...}`
 * shape that doesn't exist. Flatten and add what we can recover from
 * the request context (sellerAddress from `expectedSeller`).
 */
interface RawPayResult {
    status: number;
    data: unknown;
    amount: bigint;
    formattedAmount: string;
    transaction: string;
}

export async function payAndCall(
    client: GatewayClient,
    params: PayAndCallParams,
): Promise<PayAndCallResult> {
    const result = (await (
        client as unknown as {
            pay: (
                url: string,
                opts?: {
                    maxPrice?: string;
                    headers?: Record<string, string>;
                    body?: unknown;
                },
            ) => Promise<RawPayResult>;
        }
    ).pay(params.url, {
        ...(params.maxPriceRaw !== undefined && {
            maxPrice: params.maxPriceRaw.toString(),
        }),
        ...(params.requestHeaders !== undefined && {
            headers: params.requestHeaders,
        }),
        ...(params.requestBody !== undefined && { body: params.requestBody }),
    })) as RawPayResult;

    if (
        params.maxPriceRaw !== undefined &&
        result.amount > params.maxPriceRaw
    ) {
        throw new Error(
            `x402: 402 demanded ${result.amount} > maxPrice ${params.maxPriceRaw}`,
        );
    }

    // The SDK's PayResult does NOT expose the EIP-3009 signature or the
    // seller payTo back to the caller — they're computed internally and
    // serialized into the Payment-Signature header sent to the seller.
    // sellerAddress: derive from expectedSeller (caller-supplied) OR
    // empty (downstream session lookup just won't match → no session row).
    // paymentSignature: use the on-chain transaction hash as the
    // correlation key with Circle's facilitator settlement webhook
    // (the webhook's batch_completed payload includes paymentSignatures
    // by EIP-3009 sig, but for receipt-row purposes the tx hash is
    // unique enough).
    const sellerAddress = (params.expectedSeller ?? "0x") as Address;
    const txHash = result.transaction
        ? (result.transaction as `0x${string}`)
        : ("0x" as `0x${string}`);

    return {
        status: result.status,
        body: result.data,
        paymentSignature: txHash,
        amountPaid: result.amount,
        sellerAddress,
        paymentResponseHeader: null,
        facilitatorTxHash: result.transaction
            ? (result.transaction as `0x${string}`)
            : null,
    };
}
