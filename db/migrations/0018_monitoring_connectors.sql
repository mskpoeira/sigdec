CREATE TABLE monitoring_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  provider_code varchar(80) NOT NULL,
  display_name text NOT NULL,
  mode varchar(20) NOT NULL CHECK(mode IN ('WEBHOOK','POLLING','MANUAL')),
  status varchar(20) NOT NULL DEFAULT 'CONFIGURED' CHECK(status IN ('CONFIGURED','ACTIVE','PAUSED','ERROR','DISABLED')),
  external_reference text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text
);

CREATE INDEX monitoring_connectors_org_status_idx
  ON monitoring_connectors(organization_id,status,updated_at DESC);
CREATE INDEX monitoring_connectors_station_idx
  ON monitoring_connectors(station_id,updated_at DESC);

INSERT INTO permissions(code,description) VALUES
('connectors.manage','Gerenciar conectores de monitoramento')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code='connectors.manage'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE monitoring_connectors IS
  'Registro de conectores por estação. Credenciais não devem ser persistidas em config; segredos devem usar mecanismo seguro próprio.';
