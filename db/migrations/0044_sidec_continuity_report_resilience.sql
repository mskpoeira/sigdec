CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_retry_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation varchar(30) NOT NULL CHECK(operation IN ('REPLICATE','SYNC_POLICY')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposal_id,operation)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_retry_jobs_due_idx
  ON sidec_continuity_change_report_retry_jobs(next_retry_at)
  WHERE succeeded_at IS NULL;

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_restore_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination varchar(20) NOT NULL CHECK(destination IN ('PRIMARY','REPLICA')),
  expected_hash char(64) NOT NULL CHECK(expected_hash ~ '^[a-f0-9]{64}$'),
  observed_hash char(64),
  expected_size bigint NOT NULL CHECK(expected_size >= 0),
  observed_size bigint,
  pdf_header_valid boolean,
  success boolean NOT NULL,
  duration_ms integer NOT NULL CHECK(duration_ms >= 0),
  trigger_source varchar(20) NOT NULL DEFAULT 'SCHEDULED'
    CHECK(trigger_source IN ('SCHEDULED','MANUAL')),
  error_message text,
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_restore_drills_idx
  ON sidec_continuity_change_report_restore_drills(proposal_id,destination,performed_at DESC);

DROP TRIGGER IF EXISTS sidec_continuity_change_report_restore_drills_immutable
  ON sidec_continuity_change_report_restore_drills;
CREATE TRIGGER sidec_continuity_change_report_restore_drills_immutable
BEFORE UPDATE OR DELETE ON sidec_continuity_change_report_restore_drills
FOR EACH ROW EXECUTE FUNCTION prevent_sidec_continuity_history_mutation();

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_resilience_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  condition varchar(30) NOT NULL
    CHECK(condition IN ('CRITICAL','MISSING_REPLICA','POLICY_DRIFT','STALE','RESTORE_FAILURE')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  alerted_at timestamptz,
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS sidec_continuity_change_report_resilience_open_unique
  ON sidec_continuity_change_report_resilience_conditions(proposal_id,condition)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_resilience_open_idx
  ON sidec_continuity_change_report_resilience_conditions(organization_id,first_detected_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE sidec_continuity_change_report_retry_jobs IS
  'Fila idempotente de retry/backoff para criação e sincronização da réplica WORM dos relatórios selados.';
COMMENT ON TABLE sidec_continuity_change_report_restore_drills IS
  'Drills de restauração que baixam o PDF pela versionId, recalculam SHA-256 e validam a assinatura %PDF-.';
COMMENT ON TABLE sidec_continuity_change_report_resilience_conditions IS
  'Condições persistentes de degradação dos relatórios WORM usadas para acompanhamento operacional.';
