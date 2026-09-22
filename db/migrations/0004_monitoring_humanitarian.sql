CREATE TABLE monitoring_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  name text NOT NULL,
  station_type varchar(40) NOT NULL,
  provider text,
  external_id text,
  latitude double precision,
  longitude double precision,
  location geography(Point,4326),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitoring_station_type_check CHECK (station_type IN ('RAIN_GAUGE','RIVER_LEVEL','WEATHER','SLOPE','CAMERA','OTHER')),
  CONSTRAINT monitoring_stations_org_code_unique UNIQUE (organization_id,code)
);
CREATE INDEX monitoring_stations_location_gix ON monitoring_stations USING GIST(location);

CREATE TABLE monitoring_readings (
  id bigserial PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL,
  metric varchar(50) NOT NULL,
  value numeric(14,4) NOT NULL,
  unit varchar(30) NOT NULL,
  source varchar(40) NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(station_id,measured_at,metric)
);
CREATE INDEX monitoring_readings_station_time_idx ON monitoring_readings(station_id,measured_at DESC);

CREATE TABLE volunteers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  document_ref text,
  phone text,
  email text,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE',
  availability text,
  shirt_size varchar(20),
  raincoat_size varchar(20),
  shoe_size varchar(20),
  skills text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT volunteers_status_check CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED'))
);
CREATE INDEX volunteers_org_status_idx ON volunteers(organization_id,status,full_name);

CREATE TABLE shelters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address_line text,
  neighborhood text,
  capacity_people integer NOT NULL DEFAULT 0 CHECK (capacity_people >= 0),
  status varchar(30) NOT NULL DEFAULT 'STANDBY',
  opened_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shelters_status_check CHECK (status IN ('STANDBY','OPEN','FULL','CLOSED'))
);

CREATE TABLE assisted_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  shelter_id uuid REFERENCES shelters(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  document_ref text,
  phone text,
  address_origin text,
  neighborhood_origin text,
  adults integer NOT NULL DEFAULT 0 CHECK(adults >= 0),
  children integer NOT NULL DEFAULT 0 CHECK(children >= 0),
  elderly integer NOT NULL DEFAULT 0 CHECK(elderly >= 0),
  persons_with_disability integer NOT NULL DEFAULT 0 CHECK(persons_with_disability >= 0),
  condition varchar(20) NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  departed_at timestamptz,
  notes text,
  CONSTRAINT assisted_households_condition_check CHECK (condition IN ('DISPLACED','HOMELESS'))
);
CREATE INDEX assisted_households_org_idx ON assisted_households(organization_id,admitted_at DESC);

CREATE TABLE humanitarian_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(60) NOT NULL,
  name text NOT NULL,
  unit varchar(30) NOT NULL,
  category varchar(50) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE TABLE humanitarian_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  household_id uuid REFERENCES assisted_households(id) ON DELETE SET NULL,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  delivered_by uuid NOT NULL REFERENCES users(id),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  recipient_name text NOT NULL,
  recipient_document_ref text,
  notes text
);

CREATE TABLE humanitarian_delivery_items (
  delivery_id uuid NOT NULL REFERENCES humanitarian_deliveries(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES humanitarian_items(id),
  quantity numeric(12,2) NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(delivery_id,item_id)
);

INSERT INTO permissions(code,description) VALUES
('monitoring.read','Consultar monitoramento e leituras'),
('monitoring.manage','Gerenciar estações e leituras'),
('volunteers.read','Consultar voluntários'),
('volunteers.manage','Gerenciar voluntários'),
('humanitarian.read','Consultar abrigos, famílias e assistência humanitária'),
('humanitarian.manage','Gerenciar abrigos, famílias, estoque e entregas humanitárias')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;
