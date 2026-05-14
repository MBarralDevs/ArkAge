-- Plan E.1 phase 2.2 — counter-party response window for disputes.
--
-- Adds two nullable columns to x402_disputes so the seller (or their
-- evaluator) can submit evidence in reply to a buyer's dispute. Today
-- the dispute is one-sided: buyer raises → workflow auto-resolves.
-- After this migration, the workflow can wait for a counter-party
-- response within a configurable window before resolving.
--
-- Both columns are nullable + forward-only:
--   counterparty_response_jsonb — free-form evidence the seller submits.
--                                 Mirrors the existing evidence_jsonb on
--                                 the buyer side. Indexers + the timeline
--                                 page render this verbatim.
--   counterparty_responded_at   — set the moment the seller posts; left
--                                 NULL means the response window is
--                                 either still open or already lapsed
--                                 without a reply.
--
-- No CHECK constraint enforcing "if responded_at is set then jsonb is too"
-- — keep room for the seller to submit a textual reason with no payload
-- by posting `{}` or a tiny tag. Validation lives at the MCP-tool layer.

ALTER TABLE "x402_disputes"
    ADD COLUMN "counterparty_response_jsonb" JSONB,
    ADD COLUMN "counterparty_responded_at"   TIMESTAMPTZ;
