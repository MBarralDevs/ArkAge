-- Plan E2 Task 1 — ERC-8004 on-chain anchor columns for the agents table.
--
-- Adds four nullable columns capturing the two-step on-chain anchoring flow:
--
--   chain_agent_id              — IdentityRegistry token id minted to the
--                                 builder's Tier 1 wallet. Different from
--                                 the existing `agent_id` (which is our
--                                 internal/synthetic handle).
--   identity_register_tx_hash   — tx hash of the IdentityRegistry.register
--                                 call. Records Tx 1 in the two-step flow.
--   agent_registry_tx_hash      — tx hash of the AgentRegistry.registerAgent
--                                 call. Records Tx 2.
--   on_chain_registered_at      — set only after BOTH txs land successfully.
--                                 Used as the canonical "is this agent
--                                 on-chain anchored" predicate by UI/queries.
--
-- All four are nullable: existing v1/v1.5 agents are Postgres-only and stay
-- that way until the builder opts into on-chain anchoring via the new
-- `arkage:register_agent_onchain` MCP tool / dashboard CTA. Forward-only,
-- fully backward-compatible.
--
-- The unique constraint on chain_agent_id allows multiple NULLs (Postgres
-- default behaviour) so unanchored agents coexist; once anchored, each
-- chain_agent_id must be globally unique.

ALTER TABLE "agents"
    ADD COLUMN "chain_agent_id"             BIGINT,
    ADD COLUMN "identity_register_tx_hash"  BYTEA,
    ADD COLUMN "agent_registry_tx_hash"     BYTEA,
    ADD COLUMN "on_chain_registered_at"     TIMESTAMPTZ;

CREATE UNIQUE INDEX "agents_chain_agent_id_key"
    ON "agents" ("chain_agent_id");
