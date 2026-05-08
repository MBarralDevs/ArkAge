import type { Address } from "viem";
import { db } from "./db";

/**
 * Tier 1 = Builder's Circle Modular Wallet (passkey, MSCA).
 *
 * Owns ERC-8004 NFTs. Non-custodial. Used for identity ops, high-value
 * transactions, policy issuance, recovery — anything that exceeds Tier 2
 * runtime capability.
 *
 * The actual passkey ceremony (WebAuthn) happens client-side in the
 * Plan C dashboard. This module only handles the server-side bookkeeping:
 * recording the resolved wallet address and producing "pending Tier 1
 * signature" descriptors that MCP tools return when an action exceeds
 * Tier 2 authority.
 */

export interface RegisterTier1Params {
    builderId: bigint;
    address: Address;
}

/** Persist a newly-provisioned Tier 1 wallet (called from the dashboard's onboarding callback). */
export async function registerTier1Wallet(params: RegisterTier1Params): Promise<void> {
    await db.wallet.create({
        data: {
            address: Buffer.from(params.address.replace(/^0x/, ""), "hex"),
            tier: 1,
            custody: "modular",
            accountType: "msca",
            builderId: params.builderId,
            status: "active",
        },
    });
}

/**
 * Returned by an MCP tool when an action requires a Tier 1 signature
 * (e.g. high-value transfer, identity revocation, policy update).
 *
 * The calling agent forwards this to the dashboard, which surfaces the
 * pending signature to the human via the WebAuthn challenge UI. After
 * the user signs, the dashboard submits the now-signed transaction to
 * the chain directly — the server never holds a Tier 1 private key.
 */
export interface PendingTier1Signature {
    kind: "tier1_signature_required";
    reason: "high_value" | "identity_op" | "policy_update" | "revocation";
    unsignedTx: { to: Address; data: `0x${string}`; value: string };
}
