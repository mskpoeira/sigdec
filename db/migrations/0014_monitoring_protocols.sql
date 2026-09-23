CREATE TABLE monitoring_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  metric varchar(50) NOT NULL,
  severity varchar(20) NOT NULL CHECK(severity IN ('WATCH','WARNING','EMERGENCY')),
  comparison varchar(10) NOT NULL CHECK(comparison IN ('GTE','LTE')),
  threshold_value numeric(14,4) NOT NULL,
  unit varchar(30) NOT NULL,
  title text NOT NULL,
  guidance text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitoring_thresholds_station_metric_idx
  ON monitoring_thresholds(station_id,metric,active);

CREATE TABLE monitoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  reading_id bigint NOT NULL REFERENCES monitoring_readings(id) ON DELETE CASCADE,
  threshold_id uuid NOT NULL REFERENCES monitoring_thresholds(id) ON DELETE CASCADE,
  severity varchar(20) NOT NULL CHECK(severity IN ('WATCH','WARNING','EMERGENCY')),
  metric varchar(50) NOT NULL,
  observed_value numeric(14,4) NOT NULL,
  threshold_value numeric(14,4) NOT NULL,
  unit varchar(30) NOT NULL,
  title text NOT NULL,
  guidance text,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz,
  UNIQUE(reading_id,threshold_id)
);

CREATE INDEX monitoring_events_org_status_idx
  ON monitoring_events(organization_id,status,created_at DESC);
CREATE INDEX monitoring_events_station_idx
  ON monitoring_events(station_id,created_at DESC);

COMMENT ON TABLE monitoring_events IS
  'Eventos operacionais derivados de leituras e limiares; não publicam alertas externos automaticamente.';
