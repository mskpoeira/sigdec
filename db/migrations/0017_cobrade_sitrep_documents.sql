ALTER TABLE operational_protocols
  ADD COLUMN IF NOT EXISTS cobrade_code varchar(30);

CREATE INDEX IF NOT EXISTS operational_protocols_cobrade_idx
  ON operational_protocols(organization_id,cobrade_code)
  WHERE cobrade_code IS NOT NULL;

CREATE TABLE operational_protocol_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(60) NOT NULL,
  cobrade_code varchar(30) NOT NULL,
  title text NOT NULL,
  category varchar(80) NOT NULL DEFAULT 'MONITORING',
  severity varchar(20) CHECK(severity IN ('INFO','WATCH','WARNING','EMERGENCY')),
  trigger_summary text,
  guidance text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX operational_protocol_templates_global_unique
  ON operational_protocol_templates(code,cobrade_code)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX operational_protocol_templates_org_unique
  ON operational_protocol_templates(organization_id,code,cobrade_code)
  WHERE organization_id IS NOT NULL;

ALTER TABLE technical_documents
  ADD COLUMN IF NOT EXISTS source_type varchar(40),
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS technical_documents_source_idx
  ON technical_documents(organization_id,source_type,created_at DESC)
  WHERE source_type IS NOT NULL;

COMMENT ON TABLE operational_protocol_templates IS
  'Modelos reutilizáveis de protocolos associados a códigos COBRADE; podem ser globais ou específicos da organização.';
COMMENT ON COLUMN technical_documents.source_snapshot IS
  'Snapshot imutável da fonte automatizada usada para elaborar o rascunho documental.';
