ALTER TABLE risk_registers DROP CONSTRAINT IF EXISTS risk_registers_status_check;
ALTER TABLE risk_registers
  ADD CONSTRAINT risk_registers_status_check CHECK(status IN ('ACTIVE','MITIGATED','CLOSED'));

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_status_check;
ALTER TABLE alerts
  ADD CONSTRAINT alerts_status_check CHECK(status IN ('DRAFT','PUBLISHED','CLOSED'));

CREATE INDEX IF NOT EXISTS alerts_org_status_idx ON alerts(organization_id,status);
