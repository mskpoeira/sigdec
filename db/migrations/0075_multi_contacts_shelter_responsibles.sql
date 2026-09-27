-- Multiple contacts and shelter responsibles
CREATE TABLE IF NOT EXISTS shelter_responsibles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 shelter_id uuid NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
 full_name text NOT NULL,
 role_label text,
 address_line text,
 neighborhood text,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shelter_responsibles_shelter ON shelter_responsibles(organization_id,shelter_id,active);

CREATE TABLE IF NOT EXISTS contact_points (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 owner_type text NOT NULL CHECK(owner_type IN ('SHELTER_RESPONSIBLE','USER','VOLUNTEER','HOUSEHOLD_RESPONSIBLE','PERSON')),
 owner_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('PHONE','EMAIL')),
 value text NOT NULL,
 label text,
 phone_type text CHECK(phone_type IS NULL OR phone_type IN ('MOBILE','LANDLINE')),
 is_whatsapp boolean NOT NULL DEFAULT false,
 is_primary boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_points_owner ON contact_points(organization_id,owner_type,owner_id,active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_points_value ON contact_points(organization_id,owner_type,owner_id,kind,lower(value)) WHERE active=true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_points_primary ON contact_points(organization_id,owner_type,owner_id,kind) WHERE active=true AND is_primary=true;
