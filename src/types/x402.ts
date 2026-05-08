import type { Address } from "viem";

/**
 * Cross-file shared shapes for the x402 facilitator overlay.
 *
 * Plan D wraps Circle's hosted facilitator; we never define our own
 * scheme. These types reflect the public x402 protocol envelope.
 */

export interface X402PaymentRequirement {
    scheme: "exact" | "exact_evm" | "gateway_batched";
    network: string;
    asset: Address;
    amount: bigint;
    payTo: Address;
    validBeforeSec: number;
    facilitator?: string;
    description?: string;
}

export interface X402Receipt {
    paymentSignature: `0x${string}`;
    amount: bigint;
    payee: Address;
    payer: Address;
    asset: Address;
    facilitatorTxHash?: `0x${string}`;
    facilitatorProcessedAt: Date;
}
