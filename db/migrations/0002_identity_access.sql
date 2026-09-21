ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique
  ON organizations(slug)
  WHERE slug IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS mfa_totp_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description) VALUES
('auth.sessions.manage', 'Revogar sessões e controlar acesso'),
('auth.mfa.manage', 'Gerenciar autenticação multifator'),
('settings.manage', 'Gerenciar configurações gerais')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'MASTER'
ON CONFLICT DO NOTHING;
