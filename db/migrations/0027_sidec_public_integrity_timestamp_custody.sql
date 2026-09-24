CREATE TABLE sidec_integrity_timestamps (
  export_id uuid PRIMARY KEY REFERENCES sidec_export_artifacts(export_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  statement_hash char(64) NOT NULL,
  timestamped_at timestamptz NOT NULL,
  algorithm varchar(40) NOT NULL DEFAULT 'Ed25519' CHECK(algorithm='Ed25519'),
  key_id varchar(80) NOT NULL,
  signature text NOT NULL,
  public_key text NOT NULL,
  public_key_fingerprint char(64) NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_integrity_timestamps_org_idx
  ON sidec_integrity_timestamps(organization_id,timestamped_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_custody.read','Consultar e exportar cadeia de custódia de artefatos SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_custody.read'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_integrity_timestamps IS
  'Carimbo de tempo interno assinado Ed25519 do estado criptográfico do artefato; não equivale a TSA externa ou carimbo ICP-Brasil.';
COMMENT ON COLUMN sidec_integrity_timestamps.statement_hash IS
  'SHA-256 do statement canônico que vincula artifact_hash, manifest_hash, assinatura Ed25519 e timestamp.';
