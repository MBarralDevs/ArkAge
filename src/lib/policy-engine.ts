import type { Address } from "viem";
import type { AgentPolicy } from "./policy-canonical";

/**
 * Off-chain policy enforcement.
 *
 * Mirrors PolicyHook on-chain logic for the *stateless* checks (per-tx
 * cap, contract allowlist, counterparty allow/deny). Rolling caps
 * (perDay / perWeek) need to aggregate recent treasury_movements +
 * job_events — deferred to a follow-up task once those columns are
 * wired up by event handlers.
 *
 * Both this engine and PolicyHook MUST agree for an action to succeed
 * (spec §5). On disagreement, the on-chain check is authoritative —
 * this engine's job is to short-circuit before the user pays gas.
 */

export interface PolicyCheckRequest {
    agentDbId: bigint;
    policy: AgentPolicy;
    action: "post_job" | "fund_job" | "set_budget" | "submit_work" | "x402_pay";
    amount?: bigint;
    counterparty?: Address;
    contractTarget: Address;
}

export type PolicyVerdict =
    | { ok: true }
    | { ok: false; code: string; message: string };

export async function evaluatePolicy(req: PolicyCheckRequest): Promise<PolicyVerdict> {
    if (req.policy.validTo !== null) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec > req.policy.validTo) {
            return {
                ok: false,
                code: "policy:expired",
                message: "policy validTo has passed",
            };
        }
    }

    const target = req.contractTarget.toLowerCase();
    const allowedContracts = req.policy.allowedContracts.map((a) => a.toLowerCase());
    if (allowedContracts.length > 0 && !allowedContracts.includes(target)) {
        return {
            ok: false,
            code: "policy:contract_not_allowed",
            message: `${req.contractTarget} not in allowlist`,
        };
    }

    if (req.counterparty) {
        const cp = req.counterparty.toLowerCase();
        const denied = req.policy.counterpartyRules.denyList.map((a) => a.toLowerCase());
        if (denied.includes(cp)) {
            return {
                ok: false,
                code: "policy:counterparty_denied",
                message: `${req.counterparty} is denied`,
            };
        }
        const allowed = req.policy.counterpartyRules.allowList.map((a) => a.toLowerCase());
        if (allowed.length > 0 && !allowed.includes(cp)) {
            return {
                ok: false,
                code: "policy:counterparty_not_allowed",
                message: `${req.counterparty} not in allowlist`,
            };
        }
    }

    if (req.amount !== undefined) {
        const perTx = BigInt(req.policy.spendCaps.perTx);
        if (req.amount > perTx) {
            return {
                ok: false,
                code: "policy:per_tx_cap",
                message: `amount ${req.amount} exceeds perTx ${perTx}`,
            };
        }
        // perDay / perWeek rolling caps deferred — needs aggregation over
        // treasury_movements + job_events. Tracked as Plan B follow-up.
    }

    return { ok: true };
}
