CREATE TABLE sidec_export_artifacts (
  export_id uuid PRIMARY KEY REFERENCES sidec_exports(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  media_type varchar(100) NOT NULL DEFAULT 'application/zip',
  byte_size bigint NOT NULL CHECK(byte_size >= 0),
  content_hash char(64) NOT NULL,
  content bytea NOT NULL,
  manifest_hash char(64) NOT NULL,
  signature_algorithm varchar(40) NOT NULL DEFAULT 'HMAC-SHA256',
  manifest_signature char(64) NOT NULL,
  signed_by uuid NOT NULL REFERENCES users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_export_artifacts_org_created_idx
  ON sidec_export_artifacts(organization_id,created_at DESC);

CREATE TABLE sidec_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type varchar(30) NOT NULL CHECK(scope_type IN ('DEFAULT','COBRADE','INCIDENT_TYPE')),
  scope_value varchar(80) NOT NULL DEFAULT '*',
  document_type varchar(40) NOT NULL CHECK(document_type IN ('REPORT','OPINION','INTERDICTION','DECLARATION','FORM','OTHER')),
  label varchar(200) NOT NULL,
  min_count smallint NOT NULL DEFAULT 1 CHECK(min_count BETWEEN 1 AND 20),
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,scope_type,scope_value,document_type)
);

CREATE INDEX sidec_document_requirements_scope_idx
  ON sidec_document_requirements(organization_id,scope_type,scope_value,enabled);

INSERT INTO permissions(code,description) VALUES
('sidec_document_requirements.manage','Configurar documentos obrigatórios para interoperabilidade SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_document_requirements.manage'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_export_artifacts IS
  'ZIP final imutável de uma revisão SIDEC, selado no momento da exportação e servido sem regeneração posterior.';
COMMENT ON COLUMN sidec_export_artifacts.manifest_signature IS
  'Assinatura interna HMAC-SHA256 do hash do manifesto; não equivale a assinatura ICP-Brasil.';
COMMENT ON TABLE sidec_document_requirements IS
  'Regras municipais de documentos emitidos exigidos por padrão, COBRADE ou tipo de ocorrência.';
