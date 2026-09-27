ALTER TABLE contact_points ADD COLUMN IF NOT EXISTS extension text;
ALTER TABLE contact_points DROP CONSTRAINT IF EXISTS contact_points_extension_format_chk;
ALTER TABLE contact_points ADD CONSTRAINT contact_points_extension_format_chk CHECK (extension IS NULL OR extension ~ '^[0-9]{1,10}$');
