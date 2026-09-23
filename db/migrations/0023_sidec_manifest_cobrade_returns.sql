ALTER TABLE sidec_exports
  ADD COLUMN IF NOT EXISTS manifest_hash char(64);

CREATE TABLE sidec_cobrade_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cobrade_code varchar(30) NOT NULL,
  source_path varchar(120) NOT NULL,
  label varchar(200) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,cobrade_code,source_path)
);

CREATE INDEX sidec_cobrade_requirements_org_code_idx
  ON sidec_cobrade_requirements(organization_id,cobrade_code,sort_order);

CREATE TABLE sidec_return_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_exports(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schema_version varchar(40) NOT NULL,
  outcome varchar(20) NOT NULL CHECK(outcome IN ('ACKNOWLEDGED','REJECTED')),
  external_protocol text NOT NULL,
  received_at timestamptz NOT NULL,
  source_name varchar(200),
  notes text,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(export_id,payload_hash)
);

CREATE INDEX sidec_return_records_export_idx
  ON sidec_return_records(export_id,created_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_cobrade_requirements.manage','Configurar requisitos adicionais do checklist SIDEC por COBRADE'),
('sidec_returns.manage','Importar retorno estruturado de interoperabilidade SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_cobrade_requirements.manage','sidec_returns.manage')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN sidec_exports.manifest_hash IS
  'SHA-256 do manifesto lógico estável: snapshot, revisão e referências documentais oficiais.';
COMMENT ON TABLE sidec_cobrade_requirements IS
  'Requisitos adicionais configuráveis por código COBRADE; não representa regra oficial estadual pré-carregada.';
COMMENT ON TABLE sidec_return_records IS
  'Retornos estruturados importados pelo envelope SIGDEC; não implica formato oficial do SIDEC/SP.';
