ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS auth_sessions_user_mfa_idx
  ON auth_sessions(user_id,mfa_verified_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS recovery_codes_user_unused_idx
  ON recovery_codes(user_id,created_at DESC)
  WHERE used_at IS NULL;

COMMENT ON COLUMN auth_sessions.mfa_verified_at IS
  'Momento em que o segundo fator foi comprovado nesta sessão. Sessões estratégicas sem esta marca não acessam módulos protegidos após MFA habilitado.';
