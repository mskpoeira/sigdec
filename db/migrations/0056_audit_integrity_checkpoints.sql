CREATE TABLE IF NOT EXISTS audit_integrity_checkpoints (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_by_matricula varchar(32) NOT NULL,
  audit_count bigint NOT NULL CHECK (audit_count>=0),
  first_audit_id bigint,
  last_audit_id bigint,
  audit_root_hash char(64) NOT NULL,
  previous_checkpoint_hash char(64),
  checkpoint_hash char(64) NOT NULL,
  integrity_version smallint NOT NULL DEFAULT 1,
  algorithm varchar(16) NOT NULL DEFAULT 'SHA-256',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_integrity_checkpoints_org_created_idx
  ON audit_integrity_checkpoints(organization_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS audit_integrity_checkpoints_hash_idx
  ON audit_integrity_checkpoints(organization_id,checkpoint_hash);

CREATE UNIQUE INDEX IF NOT EXISTS audit_integrity_checkpoints_chain_unique_idx
  ON audit_integrity_checkpoints(organization_id,COALESCE(previous_checkpoint_hash,'GENESIS'));

CREATE OR REPLACE FUNCTION sigdec_prevent_audit_checkpoint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Pontos de verificação da auditoria são append-only e não podem ser alterados ou excluídos';
END;
$$;

DROP TRIGGER IF EXISTS audit_integrity_checkpoints_immutable ON audit_integrity_checkpoints;
CREATE TRIGGER audit_integrity_checkpoints_immutable
BEFORE UPDATE OR DELETE ON audit_integrity_checkpoints
FOR EACH ROW
EXECUTE FUNCTION sigdec_prevent_audit_checkpoint_mutation();

DROP TRIGGER IF EXISTS audit_integrity_checkpoints_no_truncate ON audit_integrity_checkpoints;
CREATE TRIGGER audit_integrity_checkpoints_no_truncate
BEFORE TRUNCATE ON audit_integrity_checkpoints
FOR EACH STATEMENT
EXECUTE FUNCTION sigdec_prevent_audit_checkpoint_mutation();

INSERT INTO permissions(code,description) VALUES
('audit.checkpoint','Criar pontos de verificação criptográfica da trilha de auditoria')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='audit.checkpoint'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE audit_integrity_checkpoints IS
  'Âncoras append-only da trilha de auditoria. Cada checkpoint registra raiz SHA-256, intervalo coberto, matrícula e encadeamento com o checkpoint anterior.';
