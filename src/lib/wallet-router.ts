import type { Address } from "viem";

/**
 * Wallet routing resolver per spec §5.4.
 *
 * Pure function: (action descriptor, agent context) → Tier 1 / Tier 2 /
 * Tier 3 / reject. Mirrors PolicyHook's on-chain logic so off-chain and
 * on-chain enforcement stay aligned — both must approve for any action
 * to succeed (spec §5).
 *
 * Escalation rules:
 *  - Inactive agent → reject everything
 *  - Identity ops (transfer 8004 NFT, register, update operator/policy,
 *    deactivate) → Tier 1 (Builder's Modular passkey wallet)
 *  - Treasury withdrawals → Tier 3 treasury
 *  - Evaluator settlement (complete/reject) → Tier 3 validator
 *  - Circle Gateway top-ups → Tier 3 gas-funder
 *  - fund_job: Tier 2 if within per-tx cap, Tier 1 if over
 *  - Everyday agent ops (post/accept/submit/x402-pay) → Tier 2
 */

export interface AgentRoutingContext {
    agentId: bigint;
    operatorWallet: Address;
    perTxCap: bigint;
    active: boolean;
}

export type IdentityOpSubject =
    | "transfer_8004_nft"
    | "burn_8004_nft"
    | "register_agent"
    | "update_operator"
    | "update_policy"
    | "deactivate";

export type RoutingAction =
    | { kind: "identity_op"; subject: IdentityOpSubject; agent: AgentRoutingContext }
    | { kind: "treasury_withdraw"; agent: AgentRoutingContext }
    | { kind: "evaluator_settlement"; agent: AgentRoutingContext }
    | { kind: "gateway_deposit"; agent: AgentRoutingContext }
    | { kind: "fund_job"; amount: bigint; agent: AgentRoutingContext }
    | {
          kind: "post_job" | "set_budget" | "submit_work" | "x402_pay";
          agent: AgentRoutingContext;
      };

export type RoutingDecision =
    | { wallet: "tier1-modular"; reason: string }
    | { wallet: "tier2-dcw" }
    | { wallet: "tier3-validator" }
    | { wallet: "tier3-treasury" }
    | { wallet: "tier3-gas-funder" }
    | { reject: true; reason: string };

export function route(action: RoutingAction): RoutingDecision {
    if (!action.agent.active) {
        return { reject: true, reason: "agent inactive" };
    }

    switch (action.kind) {
        case "identity_op":
            return { wallet: "tier1-modular", reason: action.subject };
        case "treasury_withdraw":
            return { wallet: "tier3-treasury" };
        case "evaluator_settlement":
            return { wallet: "tier3-validator" };
        case "gateway_deposit":
            return { wallet: "tier3-gas-funder" };
        case "fund_job":
            if (action.amount > action.agent.perTxCap) {
                return { wallet: "tier1-modular", reason: "amount exceeds per-tx cap" };
            }
            return { wallet: "tier2-dcw" };
        case "post_job":
        case "set_budget":
        case "submit_work":
        case "x402_pay":
            return { wallet: "tier2-dcw" };
    }
}
