ALTER TABLE monitoring_ingest_keys
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS replaces_key_id uuid REFERENCES monitoring_ingest_keys(id);

CREATE INDEX IF NOT EXISTS monitoring_ingest_keys_active_idx
  ON monitoring_ingest_keys(station_id,active,created_at DESC);

CREATE TABLE operational_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(60) NOT NULL,
  title text NOT NULL,
  category varchar(80) NOT NULL DEFAULT 'MONITORING',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE TABLE operational_protocol_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES operational_protocols(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK(version_no > 0),
  severity varchar(20) CHECK(severity IN ('INFO','WATCH','WARNING','EMERGENCY')),
  trigger_summary text,
  guidance text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
  change_summary text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(protocol_id,version_no)
);

CREATE UNIQUE INDEX operational_protocol_one_active_version
  ON operational_protocol_versions(protocol_id)
  WHERE status='ACTIVE';

ALTER TABLE monitoring_thresholds
  ADD COLUMN IF NOT EXISTS protocol_version_id uuid REFERENCES operational_protocol_versions(id) ON DELETE SET NULL;

ALTER TABLE monitoring_events
  ADD COLUMN IF NOT EXISTS protocol_version_id uuid REFERENCES operational_protocol_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS monitoring_events_protocol_idx
  ON monitoring_events(protocol_version_id,created_at DESC)
  WHERE protocol_version_id IS NOT NULL;

INSERT INTO permissions(code,description) VALUES
('protocols.manage','Gerenciar protocolos operacionais e suas versões')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code='protocols.manage'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE operational_protocols IS
  'Catálogo de protocolos operacionais versionados do SIGDEC.';
COMMENT ON TABLE operational_protocol_versions IS
  'Versões imutáveis em contexto histórico; apenas uma versão ACTIVE por protocolo.';
COMMENT ON COLUMN monitoring_events.protocol_version_id IS
  'Versão do protocolo vigente associada ao limiar quando o evento foi criado.';
