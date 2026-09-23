ALTER TABLE sidec_exports
  ADD COLUMN IF NOT EXISTS readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sidec_exports
  ALTER COLUMN schema_version SET DEFAULT '1.1';

CREATE TABLE sidec_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  source_path varchar(120) NOT NULL,
  target_field varchar(160) NOT NULL,
  required boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sidec_field_mappings_global_unique
  ON sidec_field_mappings(target_field)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX sidec_field_mappings_org_unique
  ON sidec_field_mappings(organization_id,target_field)
  WHERE organization_id IS NOT NULL;

CREATE TABLE sidec_export_documents (
  export_id uuid NOT NULL REFERENCES sidec_exports(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES technical_documents(id) ON DELETE RESTRICT,
  document_number varchar(80),
  document_title text NOT NULL,
  document_type varchar(40) NOT NULL,
  document_revision integer NOT NULL,
  content_hash char(64),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(export_id,document_id)
);

CREATE INDEX sidec_export_documents_document_idx
  ON sidec_export_documents(document_id,export_id);

INSERT INTO sidec_field_mappings(
  organization_id,source_path,target_field,required,enabled,sort_order
) VALUES
(NULL,'incident.protocol','ocorrencia.protocolo_sigdec',true,true,10),
(NULL,'incident.cobradeCode','ocorrencia.cobrade',true,true,20),
(NULL,'incident.summary','ocorrencia.resumo',true,true,30),
(NULL,'incident.status','ocorrencia.situacao',true,true,40),
(NULL,'incident.priority','ocorrencia.prioridade',true,true,50),
(NULL,'incident.description','ocorrencia.descricao',false,true,60),
(NULL,'incident.addressLine','local.endereco',false,true,70),
(NULL,'incident.neighborhood','local.bairro',false,true,80),
(NULL,'incident.referencePoint','local.referencia',false,true,90),
(NULL,'incident.latitude','local.latitude',false,true,100),
(NULL,'incident.longitude','local.longitude',false,true,110)
ON CONFLICT DO NOTHING;

INSERT INTO permissions(code,description) VALUES
('sidec_mappings.manage','Configurar mapeamento de campos SIGDEC para SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_mappings.manage'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_field_mappings IS
  'Mapeamento declarativo de campos SIGDEC para o pacote SIDEC; não executa scripts ou transformações arbitrárias.';
COMMENT ON TABLE sidec_export_documents IS
  'Manifesto imutável dos documentos técnicos selecionados para acompanhar uma revisão SIDEC.';
