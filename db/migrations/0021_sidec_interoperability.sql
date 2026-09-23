CREATE TABLE sidec_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision > 0),
  schema_version varchar(20) NOT NULL DEFAULT '1.0',
  status varchar(30) NOT NULL DEFAULT 'READY' CHECK(status IN (
    'READY','EXPORTED','SUBMITTED','ACKNOWLEDGED','REJECTED','CANCELLED'
  )),
  snapshot jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL,
  external_protocol text,
  external_notes text,
  exported_at timestamptz,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  rejected_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(incident_id,revision)
);

CREATE INDEX sidec_exports_org_status_idx
  ON sidec_exports(organization_id,status,created_at DESC);
CREATE INDEX sidec_exports_incident_idx
  ON sidec_exports(incident_id,revision DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_exports.read','Consultar pacotes de interoperabilidade SIDEC'),
('sidec_exports.manage','Gerar e atualizar pacotes de interoperabilidade SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_exports.read','sidec_exports.manage')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_exports IS
  'Snapshots versionados para interoperabilidade manual/controlada com o SIDEC/SP; não representa sincronização automática.';
COMMENT ON COLUMN sidec_exports.snapshot_hash IS
  'SHA-256 do snapshot JSON canônico usado para verificar integridade do pacote exportado.';
