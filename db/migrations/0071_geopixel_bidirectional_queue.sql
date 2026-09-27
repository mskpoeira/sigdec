-- SIGDEC v1.71 — fila bidirecional GeoPixel

CREATE TABLE IF NOT EXISTS geopixel_export_queue(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 layer_id uuid NOT NULL REFERENCES geopixel_layers(id) ON DELETE CASCADE,
 entity_type varchar(60) NOT NULL,
 entity_id uuid NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING'
   CHECK(status IN('PENDING','PROCESSING','SUCCEEDED','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz,
 delivered_at timestamptz,
 response_status integer,
 response_excerpt text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geopixel_export_queue_due_idx
  ON geopixel_export_queue(next_attempt_at) WHERE status IN('PENDING','PROCESSING');
CREATE UNIQUE INDEX IF NOT EXISTS geopixel_export_queue_pending_uidx
  ON geopixel_export_queue(layer_id,entity_type,entity_id) WHERE status='PENDING';

CREATE OR REPLACE FUNCTION sigdec_enqueue_geopixel_export()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 target_code text;
BEGIN
 target_code:=CASE TG_TABLE_NAME
   WHEN 'territorial_risk_areas' THEN 'RISK_AREA'
   WHEN 'critical_infrastructures' THEN 'CRITICAL_INFRASTRUCTURE'
   WHEN 'warning_assets' THEN 'WARNING_ASSET'
   WHEN 'shelters' THEN 'SHELTER'
   ELSE NULL
 END;
 IF target_code IS NULL THEN RETURN NEW; END IF;

 INSERT INTO geopixel_export_queue(organization_id,layer_id,entity_type,entity_id)
 SELECT NEW.organization_id,l.id,target_code,NEW.id
 FROM geopixel_layers l
 JOIN geopixel_connections c ON c.id=l.connection_id
 WHERE l.organization_id=NEW.organization_id
   AND l.active=true AND c.active=true
   AND l.local_target=target_code
   AND l.direction IN('EXPORT','BIDIRECTIONAL')
   AND l.source_type='REST_GEOJSON'
 ON CONFLICT DO NOTHING;

 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS territorial_risk_areas_geopixel_export ON territorial_risk_areas;
CREATE TRIGGER territorial_risk_areas_geopixel_export
AFTER INSERT OR UPDATE ON territorial_risk_areas
FOR EACH ROW EXECUTE FUNCTION sigdec_enqueue_geopixel_export();

DROP TRIGGER IF EXISTS critical_infrastructures_geopixel_export ON critical_infrastructures;
CREATE TRIGGER critical_infrastructures_geopixel_export
AFTER INSERT OR UPDATE ON critical_infrastructures
FOR EACH ROW EXECUTE FUNCTION sigdec_enqueue_geopixel_export();

DROP TRIGGER IF EXISTS warning_assets_geopixel_export ON warning_assets;
CREATE TRIGGER warning_assets_geopixel_export
AFTER INSERT OR UPDATE ON warning_assets
FOR EACH ROW EXECUTE FUNCTION sigdec_enqueue_geopixel_export();

DROP TRIGGER IF EXISTS shelters_geopixel_export ON shelters;
CREATE TRIGGER shelters_geopixel_export
AFTER INSERT OR UPDATE ON shelters
FOR EACH ROW EXECUTE FUNCTION sigdec_enqueue_geopixel_export();

COMMENT ON TABLE geopixel_export_queue IS
 'Fila auditável para sincronização automática SIGDEC -> GeoPixel em camadas bidirecionais REST/GeoJSON.';
