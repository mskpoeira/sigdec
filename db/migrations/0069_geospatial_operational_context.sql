-- SIGDEC v1.71 — integração geoespacial operacional

ALTER TABLE territorial_risk_areas
  ADD COLUMN IF NOT EXISTS location geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
      ELSE NULL
    END
  ) STORED;

ALTER TABLE warning_assets
  ADD COLUMN IF NOT EXISTS location geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
      ELSE NULL
    END
  ) STORED;

ALTER TABLE critical_infrastructures
  ADD COLUMN IF NOT EXISTS location geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
      ELSE NULL
    END
  ) STORED;

ALTER TABLE animal_rescues
  ADD COLUMN IF NOT EXISTS location geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
      ELSE NULL
    END
  ) STORED;

ALTER TABLE shelters
  ADD COLUMN IF NOT EXISTS location geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS territorial_risk_areas_location_gix ON territorial_risk_areas USING gist(location);
CREATE INDEX IF NOT EXISTS warning_assets_location_gix ON warning_assets USING gist(location);
CREATE INDEX IF NOT EXISTS critical_infrastructures_location_gix ON critical_infrastructures USING gist(location);
CREATE INDEX IF NOT EXISTS animal_rescues_location_gix ON animal_rescues USING gist(location);
CREATE INDEX IF NOT EXISTS shelters_location_gix ON shelters USING gist(location);
