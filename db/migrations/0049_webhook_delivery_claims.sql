ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check;

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_status_check
  CHECK(status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED'));

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS claim_token uuid;

DROP INDEX IF EXISTS webhook_deliveries_due_idx;
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('PENDING','PROCESSING');

COMMENT ON COLUMN webhook_deliveries.claim_token IS
  'Identifica a execução que assumiu a entrega; respostas tardias não podem alterar outra tentativa.';
