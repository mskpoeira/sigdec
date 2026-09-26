CREATE TABLE IF NOT EXISTS incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  media_type varchar(120) NOT NULL,
  media_kind varchar(20) NOT NULL CHECK (media_kind IN ('IMAGE','VIDEO')),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 125829120),
  sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_attachments_incident_idx
  ON incident_attachments(incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS incident_attachments_org_idx
  ON incident_attachments(organization_id, created_at DESC);

COMMENT ON TABLE incident_attachments IS
  'Fotos e vídeos vinculados a ocorrências, com integridade SHA-256 e trilha de autoria.';
