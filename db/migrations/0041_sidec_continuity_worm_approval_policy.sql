ALTER TABLE sidec_continuity_change_approvals
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS revalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS revalidated_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE sidec_continuity_change_approvals
SET valid_until=decided_at+interval '168 hours'
WHERE decision='APPROVED' AND valid_until IS NULL;

CREATE TABLE IF NOT EXISTS sidec_continuity_change_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  approval_valid_hours integer NOT NULL DEFAULT 168 CHECK(approval_valid_hours BETWEEN 1 AND 2160),
  report_worm_retention_days integer CHECK(report_worm_retention_days IS NULL OR report_worm_retention_days BETWEEN 1 AND 36500),
  report_worm_legal_hold boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_archives (
  proposal_id uuid PRIMARY KEY REFERENCES sidec_continuity_change_report_seals(proposal_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  object_key text NOT NULL,
  version_id text,
  etag text,
  storage_class text,
  object_lock_mode varchar(20) CHECK(object_lock_mode IN ('GOVERNANCE','COMPLIANCE')),
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  archived_by uuid NOT NULL REFERENCES users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket,object_key)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_archives_org_idx
  ON sidec_continuity_change_report_archives(organization_id,archived_at DESC);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_archive_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expected_hash char(64) NOT NULL CHECK(expected_hash ~ '^[a-f0-9]{64}$'),
  observed_hash char(64),
  exists_remote boolean NOT NULL,
  hash_valid boolean,
  object_lock_mode varchar(20),
  retain_until timestamptz,
  legal_hold boolean,
  verification_source varchar(30) NOT NULL DEFAULT 'MANUAL'
    CHECK(verification_source IN ('ARCHIVE','MANUAL','SCHEDULED')),
  error_message text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_archive_verifications_idx
  ON sidec_continuity_change_report_archive_verifications(proposal_id,verified_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_continuity_change.archive','Arquivar e verificar relatórios selados de mudança SIDEC em armazenamento WORM')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_continuity_change.archive'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN sidec_continuity_change_approvals.valid_until IS
  'Validade operacional da aprovação crítica. Aprovações expiradas não compõem o quorum para aplicação.';
COMMENT ON COLUMN sidec_continuity_change_approvals.revalidated_at IS
  'Instante da última revalidação explícita da decisão pelo aprovador.';
COMMENT ON TABLE sidec_continuity_change_policies IS
  'Política operacional por organização para validade de aprovações e preservação WORM do relatório selado. Não define temporalidade legal.';
COMMENT ON TABLE sidec_continuity_change_report_archives IS
  'Recibo do arquivamento WORM do PDF final previamente selado com SHA-256 e Ed25519.';
COMMENT ON TABLE sidec_continuity_change_report_archive_verifications IS
  'Histórico de verificações do relatório selado arquivado em WORM, com recálculo de SHA-256.';
