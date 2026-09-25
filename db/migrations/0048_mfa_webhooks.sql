ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  purpose varchar(20) NOT NULL CHECK(purpose IN ('SETUP','LOGIN')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  requested_ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_login_challenges_active_idx
  ON mfa_login_challenges(user_id,expires_at DESC)
  WHERE used_at IS NULL;

UPDATE users u
SET mfa_required=true,updated_at=now()
FROM user_roles ur
JOIN roles r ON r.id=ur.role_id AND r.code='MASTER'
WHERE ur.user_id=u.id
  AND u.mfa_required=false;

ALTER TABLE integration_endpoints
  ADD COLUMN IF NOT EXISTS webhook_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS webhook_active_from timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_failure_count integer NOT NULL DEFAULT 0 CHECK(delivery_failure_count>=0);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES integration_endpoints(id) ON DELETE CASCADE,
  audit_log_id bigint REFERENCES audit_logs(id) ON DELETE CASCADE,
  event_action text NOT NULL,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  response_status integer,
  response_excerpt text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id,audit_log_id)
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries(next_attempt_at)
  WHERE status='PENDING';

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON webhook_deliveries(endpoint_id,created_at DESC);

COMMENT ON COLUMN auth_sessions.mfa_verified_at IS
  'Preenchido somente quando a sessão foi criada após validação MFA.';
COMMENT ON TABLE mfa_login_challenges IS
  'Challenges de curta duração usados antes da criação da sessão para setup/validação TOTP.';
COMMENT ON TABLE webhook_deliveries IS
  'Fila auditável de entregas webhook derivadas da trilha de auditoria, com retry/backoff.';
