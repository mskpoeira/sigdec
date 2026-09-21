CREATE TABLE incident_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  name text NOT NULL,
  group_name text NOT NULL,
  parent_id uuid REFERENCES incident_types(id),
  cobrade_code varchar(32),
  default_priority varchar(2) NOT NULL DEFAULT 'P3',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_types_priority_check CHECK (default_priority IN ('P1','P2','P3','P4','P5')),
  CONSTRAINT incident_types_org_code_unique UNIQUE (organization_id, code)
);

CREATE TABLE incident_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  name text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'AVAILABLE',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_status_check CHECK (status IN ('AVAILABLE','DISPATCHED','EN_ROUTE','ON_SCENE','RETURNING','UNAVAILABLE')),
  CONSTRAINT teams_org_code_unique UNIQUE (organization_id, code)
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  plate varchar(16),
  description text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'AVAILABLE',
  active boolean NOT NULL DEFAULT true,
  odometer_km numeric(12,1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_status_check CHECK (status IN ('AVAILABLE','DISPATCHED','EN_ROUTE','ON_SCENE','RETURNING','MAINTENANCE','UNAVAILABLE')),
  CONSTRAINT vehicles_org_code_unique UNIQUE (organization_id, code)
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_type_id uuid NOT NULL REFERENCES incident_types(id),
  year integer NOT NULL,
  sequence_no integer NOT NULL,
  protocol varchar(40) NOT NULL,
  source varchar(40) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'RECEIVED',
  priority varchar(2) NOT NULL,
  risk_to_life boolean NOT NULL DEFAULT false,
  summary text NOT NULL,
  description text,
  caller_name text,
  caller_phone text,
  address_line text,
  neighborhood text,
  reference_point text,
  latitude double precision,
  longitude double precision,
  location geography(Point, 4326),
  current_team_id uuid REFERENCES teams(id),
  current_vehicle_id uuid REFERENCES vehicles(id),
  created_by uuid NOT NULL REFERENCES users(id),
  dispatched_at timestamptz,
  enroute_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_priority_check CHECK (priority IN ('P1','P2','P3','P4','P5')),
  CONSTRAINT incidents_lat_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT incidents_lon_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT incidents_org_protocol_unique UNIQUE (organization_id, protocol),
  CONSTRAINT incidents_org_sequence_unique UNIQUE (organization_id, year, sequence_no)
);

CREATE INDEX incidents_org_status_idx ON incidents(organization_id, status, created_at DESC);
CREATE INDEX incidents_org_priority_idx ON incidents(organization_id, priority, created_at DESC);
CREATE INDEX incidents_location_gix ON incidents USING GIST(location);

CREATE TABLE incident_timeline (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type varchar(80) NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX incident_timeline_incident_idx ON incident_timeline(incident_id, occurred_at ASC);

CREATE TABLE dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id),
  vehicle_id uuid REFERENCES vehicles(id),
  dispatched_by uuid NOT NULL REFERENCES users(id),
  status varchar(30) NOT NULL DEFAULT 'DISPATCHED',
  notes text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  enroute_at timestamptz,
  arrived_at timestamptz,
  released_at timestamptz,
  CONSTRAINT dispatch_status_check CHECK (status IN ('DISPATCHED','ACKNOWLEDGED','EN_ROUTE','ON_SCENE','RELEASED','CANCELLED'))
);

CREATE INDEX dispatches_incident_idx ON dispatches(incident_id, dispatched_at DESC);

CREATE TABLE incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 varchar(64),
  latitude double precision,
  longitude double precision,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description) VALUES
('incidents.read','Consultar ocorrências'),
('incidents.create','Criar ocorrências'),
('incidents.update','Atualizar ocorrências e linha do tempo'),
('incident_types.manage','Gerenciar tipos e subtipos de ocorrência'),
('dispatch.read','Consultar despachos, equipes e viaturas'),
('dispatch.create','Despachar equipes e viaturas'),
('resources.manage','Gerenciar equipes e viaturas')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

INSERT INTO incident_types (organization_id, code, name, group_name, default_priority)
VALUES
(NULL,'TREE_FALL','Queda de árvore','Árvores','P3'),
(NULL,'TREE_RISK','Árvore com risco de queda','Árvores','P3'),
(NULL,'FLOODING','Alagamento','Hidrológico','P2'),
(NULL,'INUNDATION','Inundação','Hidrológico','P2'),
(NULL,'LANDSLIDE','Deslizamento / movimento de massa','Geológico','P1'),
(NULL,'STRUCTURAL_RISK','Risco estrutural','Estrutural','P2'),
(NULL,'COLLAPSE','Desabamento','Estrutural','P1'),
(NULL,'WINDSTORM','Vendaval / destelhamento','Meteorológico','P2'),
(NULL,'COASTAL_SURGE','Ressaca / erosão costeira','Costeiro','P2'),
(NULL,'VEGETATION_FIRE','Incêndio em vegetação','Incêndio','P2'),
(NULL,'UTILITY_RISK','Poste / rede elétrica em risco','Infraestrutura','P2'),
(NULL,'PREVENTIVE_INSPECTION','Vistoria preventiva','Preventivo','P4')
ON CONFLICT (organization_id, code) DO NOTHING;

COMMENT ON TABLE incident_timeline IS 'Linha do tempo append-only; não expor UPDATE/DELETE pela aplicação.';
