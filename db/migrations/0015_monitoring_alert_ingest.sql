ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS monitoring_event_id uuid REFERENCES monitoring_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_monitoring_event_unique
  ON alerts(monitoring_event_id)
  WHERE monitoring_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS monitoring_ingest_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS monitoring_ingest_keys_station_idx
  ON monitoring_ingest_keys(station_id,active);

COMMENT ON TABLE monitoring_ingest_keys IS
  'Chaves de ingestão externa; somente hash SHA-256 é persistido. O token em claro é exibido uma única vez na criação.';

COMMENT ON COLUMN alerts.monitoring_event_id IS
  'Evento de monitoramento que originou o rascunho de alerta, quando aplicável.';
