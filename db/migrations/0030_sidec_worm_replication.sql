CREATE TABLE sidec_archive_replicas (
  export_id uuid PRIMARY KEY REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination_code varchar(40) NOT NULL DEFAULT 'SECONDARY',
  bucket text NOT NULL,
  object_key text NOT NULL,
  version_id text,
  etag text,
  storage_class text,
  object_lock_mode varchar(20) CHECK(object_lock_mode IN ('GOVERNANCE','COMPLIANCE')),
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  content_hash char(64) NOT NULL,
  replicated_by uuid NOT NULL REFERENCES users(id),
  replicated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(destination_code,bucket,object_key)
);

CREATE INDEX sidec_archive_replicas_org_idx
  ON sidec_archive_replicas(organization_id,replicated_at DESC);

CREATE TABLE sidec_archive_replica_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_replicas(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expected_hash char(64) NOT NULL,
  observed_hash char(64),
  exists_remote boolean NOT NULL,
  hash_valid boolean,
  object_lock_mode varchar(20),
  retain_until timestamptz,
  legal_hold boolean,
  verification_source varchar(30) NOT NULL DEFAULT 'SCHEDULED'
    CHECK(verification_source IN ('SCHEDULED','MANUAL','REPLICATION')),
  error_message text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_archive_replica_verifications_idx
  ON sidec_archive_replica_verifications(export_id,verified_at DESC);

COMMENT ON TABLE sidec_archive_replicas IS
  'Segunda cópia WORM do ZIP SIDEC. Pode apontar para outro endpoint S3 compatível em produção.';
COMMENT ON TABLE sidec_archive_replica_verifications IS
  'Verificações independentes da réplica WORM secundária, incluindo recálculo SHA-256.';
