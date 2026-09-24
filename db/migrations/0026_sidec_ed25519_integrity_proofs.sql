CREATE TABLE sidec_artifact_attestations (
  export_id uuid PRIMARY KEY REFERENCES sidec_export_artifacts(export_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  algorithm varchar(40) NOT NULL DEFAULT 'Ed25519' CHECK(algorithm='Ed25519'),
  key_id varchar(80) NOT NULL,
  signature text NOT NULL,
  public_key text NOT NULL,
  public_key_fingerprint char(64) NOT NULL,
  attested_by uuid NOT NULL REFERENCES users(id),
  attested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_artifact_attestations_org_idx
  ON sidec_artifact_attestations(organization_id,attested_at DESC);

CREATE TABLE sidec_integrity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid REFERENCES sidec_exports(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  proof_version varchar(40) NOT NULL,
  artifact_hash char(64) NOT NULL,
  manifest_hash char(64) NOT NULL,
  hmac_valid boolean,
  asymmetric_valid boolean,
  overall_valid boolean NOT NULL,
  verification_source varchar(30) NOT NULL DEFAULT 'API'
    CHECK(verification_source IN ('API','INTERNAL','EXTERNAL')),
  ip inet,
  user_agent text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_integrity_verifications_export_idx
  ON sidec_integrity_verifications(export_id,verified_at DESC);

CREATE INDEX sidec_integrity_verifications_hash_idx
  ON sidec_integrity_verifications(artifact_hash,manifest_hash,verified_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_integrity.read','Consultar comprovantes e histórico de integridade SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_integrity.read'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_artifact_attestations IS
  'Atestação Ed25519 separada do ZIP imutável; permite atestar artefatos históricos sem atualizar sidec_export_artifacts.';
COMMENT ON COLUMN sidec_artifact_attestations.signature IS
  'Assinatura Ed25519 base64 sobre o payload canônico que vincula manifest_hash e artifact_hash.';
COMMENT ON COLUMN sidec_artifact_attestations.public_key IS
  'Chave pública Ed25519 PEM armazenada para verificação independente sem acesso a segredos.';
COMMENT ON COLUMN sidec_artifact_attestations.public_key_fingerprint IS
  'SHA-256 da chave pública Ed25519 em DER/SPKI.';
COMMENT ON TABLE sidec_integrity_verifications IS
  'Registro de verificações de comprovantes de integridade SIDEC, sem armazenamento de segredos.';
