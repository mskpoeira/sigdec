-- SIGDEC v1.73 — MFA por dispositivo confiável

CREATE TABLE IF NOT EXISTS trusted_mfa_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_agent_hash char(64) NOT NULL CHECK(user_agent_hash ~ '^[a-f0-9]{64}$'),
  device_label varchar(240),
  first_ip inet,
  last_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS trusted_mfa_devices_user_active_idx
  ON trusted_mfa_devices(user_id,expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS trusted_mfa_devices_expiry_idx
  ON trusted_mfa_devices(expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE trusted_mfa_devices IS
  'Dispositivos/navegadores confiáveis após validação TOTP. O token bruto existe apenas em cookie HttpOnly no navegador.';
COMMENT ON COLUMN trusted_mfa_devices.user_agent_hash IS
  'Vincula o dispositivo confiável ao navegador/agente que concluiu o MFA, sem armazenar fingerprint invasiva.';
