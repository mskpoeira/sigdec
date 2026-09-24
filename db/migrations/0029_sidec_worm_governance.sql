CREATE TABLE sidec_archive_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id uuid NOT NULL REFERENCES sidec_archive_receipts(export_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL
    CHECK(event_type IN ('RETENTION_EXTENDED','LEGAL_HOLD_ENABLED')),
  previous_retain_until timestamptz,
  new_retain_until timestamptz,
  previous_legal_hold boolean,
  new_legal_hold boolean,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_archive_policy_events_export_idx
  ON sidec_archive_policy_events(export_id,created_at DESC);

COMMENT ON TABLE sidec_archive_policy_events IS
  'Histórico imutável de mudanças que aumentam a preservação WORM. A v1.21 não implementa redução de retenção nem liberação de legal hold.';
