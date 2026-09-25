CREATE TABLE field_map_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  title varchar(160) NOT NULL,
  description text NOT NULL DEFAULT '',
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location geography(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX field_map_points_org_idx ON field_map_points(organization_id,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX field_map_points_location_idx ON field_map_points USING GIST(location);
