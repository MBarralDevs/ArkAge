-- CreateTable
CREATE TABLE "builders" (
    "id" BIGSERIAL NOT NULL,
    "primary_wallet" BYTEA NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "builders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" BIGSERIAL NOT NULL,
    "address" BYTEA NOT NULL,
    "tier" SMALLINT NOT NULL,
    "custody" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "builder_id" BIGINT,
    "circle_wallet_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" DECIMAL(78,0) NOT NULL,
    "identity_owner_wallet" BYTEA NOT NULL,
    "current_operator_wallet_id" BIGINT NOT NULL,
    "current_metadata_id" BIGINT,
    "current_policy_id" BIGINT,
    "agent_wallet_address" BYTEA NOT NULL,
    "registered_at_block" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_metadata" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "metadata_uri" TEXT NOT NULL,
    "metadata_jsonb" JSONB,
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "body_jsonb" JSONB NOT NULL,
    "canonical_hash" BYTEA NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "authored_by_wallet" BYTEA NOT NULL,
    "authoring_tx" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "job_id" DECIMAL(78,0) NOT NULL,
    "client_agent_id" BIGINT NOT NULL,
    "provider_agent_id" BIGINT,
    "evaluator_address" BYTEA NOT NULL,
    "evaluator_tier" TEXT,
    "status" TEXT NOT NULL,
    "budget" DECIMAL(38,0),
    "evaluator_fee" DECIMAL(38,0),
    "description_uri" TEXT,
    "description_hash" BYTEA,
    "hook_address" BYTEA NOT NULL,
    "expired_at" TIMESTAMP(3) NOT NULL,
    "reason_hash" BYTEA,
    "created_at_block" BIGINT,
    "completed_at_block" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" BIGSERIAL NOT NULL,
    "job_id" BIGINT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "actor_address" BYTEA NOT NULL,
    "payload_jsonb" JSONB,
    "chain_id" INTEGER NOT NULL,
    "tx_hash" BYTEA NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_number" BIGINT NOT NULL,
    "block_time" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_evaluations" (
    "id" BIGSERIAL NOT NULL,
    "job_id" BIGINT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(10,4),
    "prompt_version" TEXT NOT NULL,
    "prompt_hash" BYTEA NOT NULL,
    "deliverable_hash" BYTEA NOT NULL,
    "reasoning_text" TEXT NOT NULL,
    "structured_response_jsonb" JSONB,
    "verdict" TEXT NOT NULL,
    "score" INTEGER,
    "evidence_uri" TEXT NOT NULL,
    "evidence_hash" BYTEA NOT NULL,
    "settlement_tx" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_feedback" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "submitter_address" BYTEA NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER,
    "decimals" SMALLINT,
    "tag1" TEXT,
    "tag2" TEXT,
    "endpoint" TEXT,
    "feedback_uri" TEXT,
    "feedback_hash" BYTEA,
    "job_id" BIGINT,
    "chain_id" INTEGER NOT NULL,
    "tx_hash" BYTEA NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_time" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_validations" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "validator_address" BYTEA NOT NULL,
    "request_uri" TEXT,
    "response_code" SMALLINT,
    "response_uri" TEXT,
    "requested_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reputation_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x402_endpoints" (
    "id" BIGSERIAL NOT NULL,
    "seller_agent_id" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "effective_url" TEXT NOT NULL,
    "hosting" TEXT NOT NULL,
    "price_per_call" DECIMAL(38,0) NOT NULL,
    "token_address" BYTEA NOT NULL,
    "schema_jsonb" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x402_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x402_sessions" (
    "id" BIGSERIAL NOT NULL,
    "buyer_agent_id" BIGINT NOT NULL,
    "seller_agent_id" BIGINT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x402_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x402_receipts" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "endpoint_id" BIGINT NOT NULL,
    "payment_kind" TEXT NOT NULL,
    "buyer_wallet" BYTEA NOT NULL,
    "seller_wallet" BYTEA NOT NULL,
    "amount" DECIMAL(38,0) NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "response_hash" BYTEA,
    "payment_signature" BYTEA NOT NULL,
    "http_status" SMALLINT,
    "facilitator_processed_at" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x402_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x402_disputes" (
    "id" BIGSERIAL NOT NULL,
    "receipt_id" BIGINT NOT NULL,
    "raised_by_wallet" BYTEA NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_jsonb" JSONB,
    "workflow_run_id" TEXT,
    "status" TEXT NOT NULL,
    "resolution_tx" BYTEA,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x402_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_movements" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "source_kind" TEXT,
    "source_id" BIGINT,
    "amount" DECIMAL(38,0) NOT NULL,
    "token_address" BYTEA NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" BYTEA,
    "tx_hash" BYTEA,
    "block_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "kind_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_advanced_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "parent_run_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_cursor" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" BYTEA NOT NULL,
    "last_block" BIGINT NOT NULL,
    "last_processed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_kind" TEXT,
    "target_id" TEXT,
    "payload_jsonb" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "builders_primary_wallet_key" ON "builders"("primary_wallet");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "agents_agent_id_key" ON "agents"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_agent_id_version_key" ON "policies"("agent_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_job_id_key" ON "jobs"("job_id");

-- CreateIndex
CREATE INDEX "jobs_client_agent_id_status_created_at_idx" ON "jobs"("client_agent_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_provider_agent_id_status_created_at_idx" ON "jobs"("provider_agent_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_events_job_id_block_time_idx" ON "job_events"("job_id", "block_time");

-- CreateIndex
CREATE UNIQUE INDEX "job_events_chain_id_tx_hash_log_index_key" ON "job_events"("chain_id", "tx_hash", "log_index");

-- CreateIndex
CREATE INDEX "reputation_feedback_agent_id_created_at_idx" ON "reputation_feedback"("agent_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reputation_feedback_chain_id_tx_hash_log_index_key" ON "reputation_feedback"("chain_id", "tx_hash", "log_index");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_validations_request_hash_key" ON "reputation_validations"("request_hash");

-- CreateIndex
CREATE INDEX "x402_sessions_buyer_agent_id_status_idx" ON "x402_sessions"("buyer_agent_id", "status");

-- CreateIndex
CREATE INDEX "x402_receipts_buyer_wallet_seller_wallet_facilitator_proces_idx" ON "x402_receipts"("buyer_wallet", "seller_wallet", "facilitator_processed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "x402_receipts_session_id_seq_key" ON "x402_receipts"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_run_id_key" ON "workflow_runs"("run_id");

-- CreateIndex
CREATE INDEX "workflow_runs_kind_status_last_advanced_at_idx" ON "workflow_runs"("kind", "status", "last_advanced_at");

-- CreateIndex
CREATE UNIQUE INDEX "indexer_cursor_source_chain_id_contract_address_key" ON "indexer_cursor"("source", "chain_id", "contract_address");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "builders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_current_operator_wallet_id_fkey" FOREIGN KEY ("current_operator_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_metadata" ADD CONSTRAINT "agent_metadata_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_agent_id_fkey" FOREIGN KEY ("client_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_provider_agent_id_fkey" FOREIGN KEY ("provider_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evaluations" ADD CONSTRAINT "job_evaluations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_feedback" ADD CONSTRAINT "reputation_feedback_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_validations" ADD CONSTRAINT "reputation_validations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_endpoints" ADD CONSTRAINT "x402_endpoints_seller_agent_id_fkey" FOREIGN KEY ("seller_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_sessions" ADD CONSTRAINT "x402_sessions_buyer_agent_id_fkey" FOREIGN KEY ("buyer_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_sessions" ADD CONSTRAINT "x402_sessions_seller_agent_id_fkey" FOREIGN KEY ("seller_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_receipts" ADD CONSTRAINT "x402_receipts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "x402_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_receipts" ADD CONSTRAINT "x402_receipts_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "x402_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_disputes" ADD CONSTRAINT "x402_disputes_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "x402_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
