CREATE TABLE IF NOT EXISTS sidec_continuity_approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delegator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(delegator_user_id<>delegate_user_id),
  CHECK(valid_until>valid_from)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_approval_delegations_lookup_idx
  ON sidec_continuity_approval_delegations(organization_id,delegate_user_id,valid_from,valid_until)
  WHERE revoked_at IS NULL;

ALTER TABLE sidec_continuity_change_approvals
  ADD COLUMN IF NOT EXISTS delegation_id uuid REFERENCES sidec_continuity_approval_delegations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authority_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

UPDATE sidec_continuity_change_approvals
SET authority_user_id=decided_by
WHERE authority_user_id IS NULL;

ALTER TABLE sidec_continuity_change_approvals
  ALTER COLUMN authority_user_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_replicas (
  proposal_id uuid PRIMARY KEY REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
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
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  replicated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  replicated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(destination_code,bucket,object_key)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_replicas_org_idx
  ON sidec_continuity_change_report_replicas(organization_id,replicated_at DESC);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_replica_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_replicas(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expected_hash char(64) NOT NULL CHECK(expected_hash ~ '^[a-f0-9]{64}$'),
  observed_hash char(64),
  exists_remote boolean NOT NULL,
  hash_valid boolean,
  object_lock_mode varchar(20),
  retain_until timestamptz,
  legal_hold boolean,
  verification_source varchar(30) NOT NULL DEFAULT 'SCHEDULED'
    CHECK(verification_source IN ('SCHEDULED','MANUAL','REPLICATION','POLICY')),
  error_message text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_replica_verifications_idx
  ON sidec_continuity_change_report_replica_verifications(proposal_id,verified_at DESC);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_report_archives(proposal_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination varchar(20) NOT NULL CHECK(destination IN ('PRIMARY','REPLICA')),
  event_type varchar(40) NOT NULL
    CHECK(event_type IN ('RETENTION_EXTENDED','LEGAL_HOLD_ENABLED','REPLICA_CREATED')),
  previous_retain_until timestamptz,
  new_retain_until timestamptz,
  previous_legal_hold boolean,
  new_legal_hold boolean,
  reason text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_policy_events_idx
  ON sidec_continuity_change_report_policy_events(proposal_id,created_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_continuity_change.delegate','Criar e revogar delegações temporárias para aprovação de mudanças críticas SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_continuity_change.delegate'
WHERE r.code IN ('MASTER','SIDEC_CONTINUITY_APPROVER')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_continuity_approval_delegations IS
  'Delegações formais e temporárias de autoridade para aprovação crítica; podem ser revogadas sem apagar o histórico.';
COMMENT ON COLUMN sidec_continuity_change_approvals.authority_user_id IS
  'Autoridade originária da decisão. Em aprovação delegada identifica o delegante; em aprovação direta é igual a decided_by.';
COMMENT ON TABLE sidec_continuity_change_report_replicas IS
  'Réplica WORM secundária do PDF selado da mudança de continuidade SIDEC.';
COMMENT ON TABLE sidec_continuity_change_report_replica_verifications IS
  'Histórico de verificações independentes da réplica WORM dos relatórios de mudança.';
COMMENT ON TABLE sidec_continuity_change_report_policy_events IS
  'Histórico append-only de aumentos de preservação WORM e criação de réplica; reduções não são implementadas.';
