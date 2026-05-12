-- Plan E1 Task 1 — Circle Agent Wallet onramp data model.
--
-- Adds two nullable columns to the wallets table:
--   circle_agent_wallet_email — email that controls the Circle CLI session for this Agent Wallet.
--                                Surfaces in the builder console; never exposed publicly.
--   circle_backing_eoa        — MPC-controlled EOA that produces EIP-3009 signatures on behalf
--                                of the Agent Wallet SCA. Discovered via `circle gateway balance`.
--                                Pre-flight (2026-05-12) revealed that Circle Agent Wallets are
--                                SCAs paired with this backing EOA — the SCA holds tokens but
--                                the backing EOA signs payments. See runbook
--                                docs/runbooks/circle-agent-wallet-onboarding.md.
--
-- Allowed custody values extended to include 'circle-agent-wallet'.
-- Allowed accountType values extended to include 'sca' (Smart Contract Account).
-- These are free-string columns at the DB level; the CHECK constraint below enforces the
-- invariant that an Agent-Wallet row carries both its session email AND its backing EOA.
--
-- Fully backward-compatible: existing rows (custody ∈ {modular, dcw, system, external-eoa})
-- are unaffected; both new columns are nullable.

ALTER TABLE "wallets" ADD COLUMN "circle_agent_wallet_email" TEXT,
                      ADD COLUMN "circle_backing_eoa"        BYTEA;

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_circle_agent_wallet_completeness"
    CHECK (
        custody <> 'circle-agent-wallet'
        OR (circle_agent_wallet_email IS NOT NULL
            AND circle_backing_eoa IS NOT NULL)
    );
