ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_volunteers_active_lifecycle ON volunteers(organization_id,created_at DESC) WHERE archived_at IS NULL AND deleted_at IS NULL;
