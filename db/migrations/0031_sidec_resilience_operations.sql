CREATE TABLE sidec_replica_retry_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation varchar(30) NOT NULL CHECK(operation IN ('REPLICATE','SYNC_POLICY')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(export_id,operation)
);

CREATE INDEX sidec_replica_retry_jobs_due_idx
  ON sidec_replica_retry_jobs(next_retry_at)
  WHERE succeeded_at IS NULL;

CREATE TABLE sidec_restore_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination varchar(20) NOT NULL CHECK(destination IN ('PRIMARY','REPLICA')),
  expected_hash char(64) NOT NULL,
  observed_hash char(64),
  expected_size bigint NOT NULL CHECK(expected_size >= 0),
  observed_size bigint,
  zip_header_valid boolean,
  success boolean NOT NULL,
  duration_ms integer NOT NULL CHECK(duration_ms >= 0),
  trigger_source varchar(20) NOT NULL DEFAULT 'SCHEDULED'
    CHECK(trigger_source IN ('SCHEDULED','MANUAL')),
  error_message text,
  performed_by uuid REFERENCES users(id),
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_restore_drills_export_idx
  ON sidec_restore_drills(export_id,performed_at DESC);

CREATE TABLE sidec_resilience_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  condition varchar(30) NOT NULL
    CHECK(condition IN ('CRITICAL','MISSING_REPLICA','POLICY_DRIFT','STALE')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  alerted_at timestamptz,
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX sidec_resilience_conditions_open_unique
  ON sidec_resilience_conditions(export_id,condition)
  WHERE resolved_at IS NULL;

CREATE INDEX sidec_resilience_conditions_open_idx
  ON sidec_resilience_conditions(organization_id,first_detected_at)
  WHERE resolved_at IS NULL;

INSERT INTO permissions(code,description) VALUES
('sidec_resilience.manage','Executar drills, retries e ações operacionais de resiliência SIDEC'),
('sidec_resilience.read','Consultar métricas e relatórios de resiliência SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_resilience.manage','sidec_resilience.read')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_replica_retry_jobs IS
  'Fila idempotente de retry/backoff para criação de réplica ou sincronização monotônica de política.';
COMMENT ON TABLE sidec_restore_drills IS
  'Testes de restauração que baixam a versionId exata, recalculam SHA-256 e validam assinatura básica do ZIP.';
COMMENT ON TABLE sidec_resilience_conditions IS
  'Condições degradadas persistentes usadas para alertas de resiliência; não representam incidente de Defesa Civil.';
