import { describe, it, expect } from "vitest";
import { route, type AgentRoutingContext } from "@/lib/wallet-router";

const baseAgent: AgentRoutingContext = {
    agentId: 1n,
    operatorWallet: "0xaaaa000000000000000000000000000000000001",
    perTxCap: 1_000_000n,
    active: true,
};

describe("wallet router", () => {
    it("routes identity_op (transfer_8004_nft) to Tier 1", () => {
        const decision = route({
            kind: "identity_op",
            subject: "transfer_8004_nft",
            agent: baseAgent,
        });
        expect("wallet" in decision && decision.wallet).toBe("tier1-modular");
    });

    it("routes identity_op (deactivate) to Tier 1", () => {
        const decision = route({ kind: "identity_op", subject: "deactivate", agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier1-modular");
    });

    it("routes treasury_withdraw to Tier 3 treasury", () => {
        const decision = route({ kind: "treasury_withdraw", agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier3-treasury");
    });

    it("routes evaluator_settlement to Tier 3 validator", () => {
        const decision = route({ kind: "evaluator_settlement", agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier3-validator");
    });

    it("routes gateway_deposit to Tier 3 gas-funder", () => {
        const decision = route({ kind: "gateway_deposit", agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier3-gas-funder");
    });

    it("routes within-cap fund_job to Tier 2", () => {
        const decision = route({ kind: "fund_job", amount: 500_000n, agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier2-dcw");
    });

    it("escalates over-cap fund_job to Tier 1", () => {
        const decision = route({ kind: "fund_job", amount: 2_000_000n, agent: baseAgent });
        expect("wallet" in decision && decision.wallet).toBe("tier1-modular");
    });

    it("escalates exact-cap-plus-one fund_job to Tier 1 (boundary)", () => {
        const decision = route({
            kind: "fund_job",
            amount: baseAgent.perTxCap + 1n,
            agent: baseAgent,
        });
        expect("wallet" in decision && decision.wallet).toBe("tier1-modular");
    });

    it("keeps exact-cap fund_job in Tier 2 (boundary)", () => {
        const decision = route({
            kind: "fund_job",
            amount: baseAgent.perTxCap,
            agent: baseAgent,
        });
        expect("wallet" in decision && decision.wallet).toBe("tier2-dcw");
    });

    it.each([["post_job"], ["set_budget"], ["submit_work"], ["x402_pay"]] as const)(
        "routes %s to Tier 2 by default",
        (kind) => {
            const decision = route({ kind, agent: baseAgent });
            expect("wallet" in decision && decision.wallet).toBe("tier2-dcw");
        },
    );

    it("rejects any action when agent is inactive", () => {
        const decision = route({
            kind: "fund_job",
            amount: 100n,
            agent: { ...baseAgent, active: false },
        });
        expect("reject" in decision && decision.reject).toBe(true);
    });

    it("rejects identity_op too when inactive (no Tier 1 escape hatch)", () => {
        const decision = route({
            kind: "identity_op",
            subject: "update_operator",
            agent: { ...baseAgent, active: false },
        });
        expect("reject" in decision && decision.reject).toBe(true);
    });
});
