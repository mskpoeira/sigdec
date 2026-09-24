ALTER TABLE sidec_continuity_action_items
  ADD COLUMN recurrence_key varchar(100),
  ADD CONSTRAINT sidec_continuity_action_recurrence_key_chk
    CHECK(recurrence_key IS NULL OR recurrence_key ~ '^[a-z0-9][a-z0-9._-]*$');

ALTER TABLE recovery_actions
  ADD COLUMN source_continuity_action_id uuid
    REFERENCES sidec_continuity_action_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX recovery_actions_source_continuity_action_uidx
  ON recovery_actions(source_continuity_action_id)
  WHERE source_continuity_action_id IS NOT NULL;

CREATE TABLE sidec_continuity_runbook_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recurrence_key varchar(100) NOT NULL
    CHECK(recurrence_key ~ '^[a-z0-9][a-z0-9._-]*$'),
  category varchar(30) NOT NULL
    CHECK(category IN ('PROCESS','PEOPLE','TECHNOLOGY','COMMUNICATION','DATA','STORAGE','CONNECTIVITY','OTHER')),
  severity varchar(20) NOT NULL
    CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title text NOT NULL,
  rationale text NOT NULL,
  occurrences integer NOT NULL CHECK(occurrences >= 2),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  latest_lesson_id uuid REFERENCES sidec_continuity_lessons(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','ACCEPTED','IMPLEMENTED','DISMISSED')),
  resolution_notes text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sidec_continuity_runbook_recommendations_open_uidx
  ON sidec_continuity_runbook_recommendations(organization_id,recurrence_key)
  WHERE status IN ('OPEN','ACCEPTED');

CREATE INDEX sidec_continuity_runbook_recommendations_org_idx
  ON sidec_continuity_runbook_recommendations(organization_id,status,last_seen_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_continuity_improvement.manage','Gerenciar promoções para recuperação e recomendações de melhoria do runbook')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='sidec_continuity_improvement.manage'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN sidec_continuity_action_items.recurrence_key IS
  'Chave estruturada opcional que relaciona a ação corretiva a uma lição recorrente.';
COMMENT ON COLUMN recovery_actions.source_continuity_action_id IS
  'Ação corretiva de continuidade que originou a ação de recuperação por promoção humana explícita.';
COMMENT ON TABLE sidec_continuity_runbook_recommendations IS
  'Recomendações estruturadas de revisão do runbook geradas a partir de recorrência em AARs finalizados; não alteram o runbook automaticamente.';
