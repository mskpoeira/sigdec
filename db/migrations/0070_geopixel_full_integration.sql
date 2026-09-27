-- SIGDEC v1.71 — integração corporativa GeoPixel
INSERT INTO permissions(code,description) VALUES
('geopixel.read','Consultar dados e contexto territorial sincronizados com GeoPixel'),
('geopixel.manage','Configurar conexões, camadas, mapeamentos e sincronizações GeoPixel')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code IN('geopixel.read','geopixel.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS geopixel_connections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL,
 portal_url text,
 api_base_url text,
 wms_url text,
 wfs_url text,
 auth_type varchar(20) NOT NULL DEFAULT 'NONE'
   CHECK(auth_type IN('NONE','API_KEY','BEARER','BASIC')),
 username varchar(200),
 secret_ciphertext text,
 api_key_header varchar(100) NOT NULL DEFAULT 'x-api-key',
 active boolean NOT NULL DEFAULT true,
 sync_interval_minutes integer NOT NULL DEFAULT 60 CHECK(sync_interval_minutes BETWEEN 5 AND 10080),
 config jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_test_at timestamptz,
 last_test_ok boolean,
 last_test_message text,
 last_sync_at timestamptz,
 last_sync_status varchar(20),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,name)
);

CREATE TABLE IF NOT EXISTS geopixel_layers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES geopixel_connections(id) ON DELETE CASCADE,
 code varchar(120) NOT NULL,
 title varchar(240) NOT NULL,
 source_type varchar(30) NOT NULL
   CHECK(source_type IN('REST_GEOJSON','WFS','WMS_REFERENCE')),
 remote_layer_name varchar(300),
 resource_path text,
 category varchar(60) NOT NULL DEFAULT 'OTHER'
   CHECK(category IN('CADASTRAL','ZONING','URBANISM','HOUSING','ENVIRONMENT','APP','RISK','HYDROGRAPHY','DRAINAGE','ROAD','INFRASTRUCTURE','BUILDING','LAND_USE','VEGETATION','MONITORING','OTHER')),
 direction varchar(20) NOT NULL DEFAULT 'IMPORT'
   CHECK(direction IN('IMPORT','EXPORT','BIDIRECTIONAL','REFERENCE')),
 local_target varchar(60) NOT NULL DEFAULT 'REFERENCE_ONLY'
   CHECK(local_target IN('REFERENCE_ONLY','RISK_AREA','CRITICAL_INFRASTRUCTURE','WARNING_ASSET','SHELTER')),
 attribute_map jsonb NOT NULL DEFAULT '{}'::jsonb,
 request_params jsonb NOT NULL DEFAULT '{}'::jsonb,
 export_method varchar(10) NOT NULL DEFAULT 'POST' CHECK(export_method IN('POST','PUT','PATCH')),
 remote_id_property varchar(120) NOT NULL DEFAULT 'id',
 active boolean NOT NULL DEFAULT true,
 last_sync_at timestamptz,
 last_sync_status varchar(20),
 last_sync_message text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,code)
);

CREATE TABLE IF NOT EXISTS geopixel_features(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 layer_id uuid NOT NULL REFERENCES geopixel_layers(id) ON DELETE CASCADE,
 remote_id text NOT NULL,
 geometry geometry(Geometry,4326),
 properties jsonb NOT NULL DEFAULT '{}'::jsonb,
 source_updated_at timestamptz,
 content_hash char(64),
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 synced_at timestamptz NOT NULL DEFAULT now(),
 active boolean NOT NULL DEFAULT true,
 UNIQUE(layer_id,remote_id)
);
CREATE INDEX IF NOT EXISTS geopixel_features_geometry_gix ON geopixel_features USING gist(geometry);
CREATE INDEX IF NOT EXISTS geopixel_features_org_layer_idx ON geopixel_features(organization_id,layer_id,active);
CREATE INDEX IF NOT EXISTS geopixel_features_properties_gin ON geopixel_features USING gin(properties);

CREATE TABLE IF NOT EXISTS geopixel_entity_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 feature_id uuid NOT NULL REFERENCES geopixel_features(id) ON DELETE CASCADE,
 entity_type varchar(60) NOT NULL,
 entity_id uuid NOT NULL,
 link_type varchar(30) NOT NULL DEFAULT 'REFERENCE'
   CHECK(link_type IN('REFERENCE','SOURCE','MIRROR','DERIVED')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(feature_id,entity_type,entity_id)
);

CREATE TABLE IF NOT EXISTS geopixel_sync_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES geopixel_connections(id) ON DELETE CASCADE,
 layer_id uuid REFERENCES geopixel_layers(id) ON DELETE SET NULL,
 direction varchar(20) NOT NULL CHECK(direction IN('IMPORT','EXPORT','DISCOVERY','TEST')),
 status varchar(20) NOT NULL CHECK(status IN('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 features_received integer NOT NULL DEFAULT 0,
 features_inserted integer NOT NULL DEFAULT 0,
 features_updated integer NOT NULL DEFAULT 0,
 features_deactivated integer NOT NULL DEFAULT 0,
 exported_count integer NOT NULL DEFAULT 0,
 http_status integer,
 message text,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 triggered_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS geopixel_sync_runs_org_started_idx ON geopixel_sync_runs(organization_id,started_at DESC);

COMMENT ON TABLE geopixel_connections IS 'Conexões configuráveis com a plataforma GeoPixel sem dependência de endpoint proprietário fixo.';
COMMENT ON TABLE geopixel_layers IS 'Mapeamento das camadas GeoPixel/OGC para o contexto territorial do SIGDEC.';
COMMENT ON TABLE geopixel_features IS 'Espelho geoespacial auditável de feições GeoPixel usadas pelo SIGDEC.';
