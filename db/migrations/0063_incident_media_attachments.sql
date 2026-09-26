ALTER TABLE incident_attachments
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS media_kind varchar(20),
  ADD COLUMN IF NOT EXISTS content bytea;

UPDATE incident_attachments a
SET organization_id=i.organization_id
FROM incidents i
WHERE a.incident_id=i.id
  AND a.organization_id IS NULL;

UPDATE incident_attachments
SET media_kind=CASE
  WHEN lower(mime_type) LIKE 'image/%' THEN 'IMAGE'
  WHEN lower(mime_type) LIKE 'video/%' THEN 'VIDEO'
  ELSE 'IMAGE'
END
WHERE media_kind IS NULL;

ALTER TABLE incident_attachments
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN media_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='incident_attachments_media_kind_check'
  ) THEN
    ALTER TABLE incident_attachments
      ADD CONSTRAINT incident_attachments_media_kind_check
      CHECK (media_kind IN ('IMAGE','VIDEO'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS incident_attachments_incident_created_idx
  ON incident_attachments(incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS incident_attachments_org_idx
  ON incident_attachments(organization_id, created_at DESC);

COMMENT ON TABLE incident_attachments IS
  'Fotos e vídeos vinculados a ocorrências, com integridade SHA-256, autoria e conteúdo armazenado no banco.';
