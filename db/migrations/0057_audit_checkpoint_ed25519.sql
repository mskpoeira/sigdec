CREATE TABLE IF NOT EXISTS audit_checkpoint_attestations (
  checkpoint_id bigint PRIMARY KEY REFERENCES audit_integrity_checkpoints(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  algorithm varchar(40) NOT NULL DEFAULT 'Ed25519' CHECK(algorithm='Ed25519'),
  key_id varchar(80) NOT NULL,
  signature text NOT NULL,
  public_key text NOT NULL,
  public_key_fingerprint char(64) NOT NULL,
  attested_by uuid NOT NULL REFERENCES users(id),
  attested_by_matricula varchar(32) NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_checkpoint_attestations_org_idx
  ON audit_checkpoint_attestations(organization_id,attested_at DESC);

CREATE INDEX IF NOT EXISTS audit_checkpoint_attestations_fingerprint_idx
  ON audit_checkpoint_attestations(public_key_fingerprint);

CREATE OR REPLACE FUNCTION sigdec_prevent_audit_checkpoint_attestation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Atestações Ed25519 da auditoria são append-only e não podem ser alteradas ou excluídas';
END;
$$;

DROP TRIGGER IF EXISTS audit_checkpoint_attestations_immutable ON audit_checkpoint_attestations;
CREATE TRIGGER audit_checkpoint_attestations_immutable
BEFORE UPDATE OR DELETE ON audit_checkpoint_attestations
FOR EACH ROW
EXECUTE FUNCTION sigdec_prevent_audit_checkpoint_attestation_mutation();

DROP TRIGGER IF EXISTS audit_checkpoint_attestations_no_truncate ON audit_checkpoint_attestations;
CREATE TRIGGER audit_checkpoint_attestations_no_truncate
BEFORE TRUNCATE ON audit_checkpoint_attestations
FOR EACH STATEMENT
EXECUTE FUNCTION sigdec_prevent_audit_checkpoint_attestation_mutation();

COMMENT ON TABLE audit_checkpoint_attestations IS
  'Atestação Ed25519 portátil de checkpoints da auditoria, contendo chave pública e fingerprint SHA-256 para verificação independente.';
