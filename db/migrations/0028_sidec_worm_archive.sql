CREATE TABLE sidec_archive_receipts (
  export_id uuid PRIMARY KEY REFERENCES sidec_export_artifacts(export_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  object_key text NOT NULL,
  version_id text,
  etag text,
  storage_class text,
  object_lock_mode varchar(20) CHECK(object_lock_mode IN ('GOVERNANCE','COMPLIANCE')),
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  content_hash char(64) NOT NULL,
  archived_by uuid NOT NULL REFERENCES users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket,object_key)
);

CREATE INDEX sidec_archive_receipts_org_idx
  ON sidec_archive_receipts(organization_id,archived_at DESC);

CREATE TABLE sidec_archive_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expected_hash char(64) NOT NULL,
  observed_hash char(64),
  exists_remote boolean NOT NULL,
  hash_valid boolean,
  object_lock_mode varchar(20),
  retain_until timestamptz,
  legal_hold boolean,
  verification_source varchar(30) NOT NULL DEFAULT 'SCHEDULED'
    CHECK(verification_source IN ('SCHEDULED','MANUAL','ARCHIVE')),
  error_message text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_archive_verifications_export_idx
  ON sidec_archive_verifications(export_id,verified_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_archive.manage','Arquivar e verificar artefatos SIDEC em armazenamento Object Lock')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_archive.manage'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_archive_receipts IS
  'Recibo do arquivamento externo S3/MinIO Object Lock do ZIP selado; o modo de retenção é técnico e não define temporalidade legal.';
COMMENT ON TABLE sidec_archive_verifications IS
  'Verificações periódicas ou manuais do objeto arquivado, incluindo recálculo SHA-256 dos bytes remotos.';
