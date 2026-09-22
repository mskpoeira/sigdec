CREATE TABLE field_positions (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_meters double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  location geography(Point, 4326) NOT NULL,
  CONSTRAINT field_positions_lat_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT field_positions_lon_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT field_positions_accuracy_check CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

CREATE INDEX field_positions_org_recorded_idx
  ON field_positions(organization_id, recorded_at DESC);
CREATE INDEX field_positions_team_recorded_idx
  ON field_positions(team_id, recorded_at DESC)
  WHERE team_id IS NOT NULL;
CREATE INDEX field_positions_location_gix
  ON field_positions USING GIST(location);

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  inspection_type varchar(40) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'SCHEDULED',
  risk_level varchar(16) NOT NULL DEFAULT 'UNASSESSED',
  requested_by uuid NOT NULL REFERENCES users(id),
  assigned_to uuid REFERENCES users(id),
  address_line text NOT NULL,
  neighborhood text,
  reference_point text,
  latitude double precision,
  longitude double precision,
  location geography(Point, 4326),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  findings text,
  recommendations text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspections_type_check CHECK (
    inspection_type IN ('PREVENTIVE','STRUCTURAL','TREE','SLOPE','FLOOD','POST_EVENT','OTHER')
  ),
  CONSTRAINT inspections_status_check CHECK (
    status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')
  ),
  CONSTRAINT inspections_risk_check CHECK (
    risk_level IN ('UNASSESSED','LOW','MODERATE','HIGH','CRITICAL')
  ),
  CONSTRAINT inspections_lat_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT inspections_lon_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX inspections_org_status_idx
  ON inspections(organization_id, status, created_at DESC);
CREATE INDEX inspections_incident_idx
  ON inspections(incident_id, created_at DESC)
  WHERE incident_id IS NOT NULL;
CREATE INDEX inspections_location_gix
  ON inspections USING GIST(location);

CREATE TABLE inspection_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_order integer NOT NULL,
  label text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  observation text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_checklist_order_unique UNIQUE (inspection_id, item_order)
);

INSERT INTO permissions (code, description) VALUES
('field.read', 'Consultar mapa e operação de campo'),
('field.location.update', 'Registrar localização própria em campo'),
('inspections.read', 'Consultar vistorias'),
('inspections.manage', 'Criar e atualizar vistorias')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'field.read', 'field.location.update', 'inspections.read', 'inspections.manage'
)
WHERE r.code = 'MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE field_positions IS 'Histórico de posições informadas por agentes em campo.';
COMMENT ON TABLE inspections IS 'Vistorias preventivas, emergenciais e pós-evento vinculáveis a ocorrências.';
