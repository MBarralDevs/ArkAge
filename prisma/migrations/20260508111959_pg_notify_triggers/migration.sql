-- pg_notify triggers for live UI streams (Plan C Phase 2 Task 4).
--
-- Channels:
--   arkage:job:<jobId>      — per-job event stream
--   arkage:jobs             — all jobs (list pages)
--   arkage:agent:<agentId>  — reputation feedback
--   arkage:x402:session:<id> — per-session receipts
--   arkage:protocol-pulse   — coarse counter ticks (any of the above)
--
-- Triggers fire AFTER INSERT inside the inserting transaction so
-- consumers only see post-commit deliveries — no lost events on rollback.

CREATE OR REPLACE FUNCTION arkage_notify_job_event() RETURNS trigger AS $$
DECLARE
  payload TEXT;
BEGIN
  payload := json_build_object(
    'jobId', NEW.job_id::text,
    'eventKind', NEW.event_kind,
    'blockTime', NEW.block_time,
    'txHash', encode(NEW.tx_hash, 'hex')
  )::text;
  PERFORM pg_notify('arkage:job:' || NEW.job_id::text, payload);
  PERFORM pg_notify('arkage:jobs', payload);
  PERFORM pg_notify('arkage:protocol-pulse', json_build_object('kind', 'job_event')::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arkage_job_event_notify ON job_events;
CREATE TRIGGER arkage_job_event_notify
  AFTER INSERT ON job_events
  FOR EACH ROW EXECUTE FUNCTION arkage_notify_job_event();


CREATE OR REPLACE FUNCTION arkage_notify_x402_receipt() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'arkage:x402:session:' || NEW.session_id::text,
    json_build_object('seq', NEW.seq, 'amount', NEW.amount::text, 'httpStatus', NEW.http_status)::text
  );
  PERFORM pg_notify('arkage:protocol-pulse', json_build_object('kind', 'x402_receipt')::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arkage_x402_receipt_notify ON x402_receipts;
CREATE TRIGGER arkage_x402_receipt_notify
  AFTER INSERT ON x402_receipts
  FOR EACH ROW EXECUTE FUNCTION arkage_notify_x402_receipt();


CREATE OR REPLACE FUNCTION arkage_notify_reputation() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'arkage:agent:' || NEW.agent_id::text,
    json_build_object('score', NEW.score, 'tag2', NEW.tag2)::text
  );
  PERFORM pg_notify('arkage:protocol-pulse', json_build_object('kind', 'reputation')::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arkage_reputation_notify ON reputation_feedback;
CREATE TRIGGER arkage_reputation_notify
  AFTER INSERT ON reputation_feedback
  FOR EACH ROW EXECUTE FUNCTION arkage_notify_reputation();
