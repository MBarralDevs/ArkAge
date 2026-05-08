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

interface RawPayResult {
    status: number;
    data: unknown;
    headers?: Record<string, string>;
    payment: {
        signature?: `0x${string}`;
        amount?: string;
        payTo?: string;
        settlementTxHash?: `0x${string}`;
    };
}

/** Execute a paid request through the GatewayClient SDK. */
export async function payAndCall(
    client: GatewayClient,
    params: PayAndCallParams,
): Promise<PayAndCallResult> {
    // The SDK's `pay()` returns `PayResult<T>` with a different surface
    // shape across versions. We cast through `unknown` and normalize.
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

    const paymentResponseHeader = result.headers?.["payment-response"] ?? null;

    if (
        params.expectedSeller &&
        result.payment?.payTo?.toLowerCase() !==
            params.expectedSeller.toLowerCase()
    ) {
        throw new Error(
            `x402: expected seller ${params.expectedSeller} but 402 declared ${result.payment?.payTo}`,
        );
    }
    if (
        params.maxPriceRaw !== undefined &&
        BigInt(result.payment?.amount ?? "0") > params.maxPriceRaw
    ) {
        throw new Error(
            `x402: 402 demanded ${result.payment?.amount} > maxPrice ${params.maxPriceRaw}`,
        );
    }

    return {
        status: result.status,
        body: result.data,
        paymentSignature: (result.payment.signature ??
            "0x") as `0x${string}`,
        amountPaid: BigInt(result.payment.amount ?? "0"),
        sellerAddress: (result.payment.payTo ?? "0x") as Address,
        paymentResponseHeader,
        facilitatorTxHash: result.payment.settlementTxHash ?? null,
    };
}
