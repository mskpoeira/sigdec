CREATE TABLE civil_defense_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  action_type varchar(40) NOT NULL CHECK(action_type IN (
    'PREVENTION','PREPAREDNESS','MONITORING','INSPECTION','RESPONSE',
    'HUMANITARIAN','TRAINING','RECOVERY','COMMUNICATION','OTHER'
  )),
  title text NOT NULL,
  description text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  address_line text,
  neighborhood text,
  latitude double precision,
  longitude double precision,
  location geography(Point,4326),
  participants_count integer NOT NULL DEFAULT 0 CHECK(participants_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);

CREATE INDEX civil_defense_actions_org_time_idx
  ON civil_defense_actions(organization_id,started_at DESC);
CREATE INDEX civil_defense_actions_incident_idx
  ON civil_defense_actions(incident_id,started_at DESC)
  WHERE incident_id IS NOT NULL;
CREATE INDEX civil_defense_actions_location_gix
  ON civil_defense_actions USING GIST(location);

CREATE TABLE operational_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  request_type varchar(40) NOT NULL CHECK(request_type IN (
    'HUMANITARIAN_AID','EMERGENCY_INSPECTION','STATE_SUPPORT','LOGISTICS','EQUIPMENT','OTHER'
  )),
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK(status IN (
    'DRAFT','SUBMITTED','IN_ANALYSIS','APPROVED','REJECTED','COMPLETED','CANCELLED'
  )),
  destination varchar(160),
  justification text NOT NULL,
  requested_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_protocol text,
  submitted_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_support_requests_org_status_idx
  ON operational_support_requests(organization_id,status,created_at DESC);
CREATE INDEX operational_support_requests_incident_idx
  ON operational_support_requests(incident_id,created_at DESC)
  WHERE incident_id IS NOT NULL;

INSERT INTO permissions(code,description) VALUES
('actions.read','Consultar registro de ações da Defesa Civil'),
('actions.manage','Registrar e atualizar ações da Defesa Civil'),
('support_requests.read','Consultar solicitações operacionais'),
('support_requests.manage','Gerenciar solicitações operacionais')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'actions.read','actions.manage','support_requests.read','support_requests.manage'
)
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE civil_defense_actions IS
  'Registro das ações municipais de proteção e defesa civil, inspirado no fluxo operacional do SIDEC/SP.';
COMMENT ON TABLE operational_support_requests IS
  'Solicitações operacionais baseadas em ocorrências, ações, vistorias e assistência humanitária.';
