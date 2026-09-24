ALTER TABLE sidec_export_artifacts
  ADD COLUMN IF NOT EXISTS asymmetric_algorithm varchar(40),
  ADD COLUMN IF NOT EXISTS asymmetric_key_id varchar(80),
  ADD COLUMN IF NOT EXISTS asymmetric_signature text,
  ADD COLUMN IF NOT EXISTS asymmetric_public_key text,
  ADD COLUMN IF NOT EXISTS asymmetric_public_key_fingerprint char(64);

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

COMMENT ON COLUMN sidec_export_artifacts.asymmetric_signature IS
  'Assinatura Ed25519 do hash do manifesto, codificada em base64.';
COMMENT ON COLUMN sidec_export_artifacts.asymmetric_public_key IS
  'Chave pública Ed25519 PEM armazenada junto do artefato para verificação independente.';
COMMENT ON COLUMN sidec_export_artifacts.asymmetric_public_key_fingerprint IS
  'SHA-256 da chave pública Ed25519 em DER/SPKI.';
COMMENT ON TABLE sidec_integrity_verifications IS
  'Registro de verificações de comprovantes de integridade SIDEC, sem armazenamento de segredos.';
