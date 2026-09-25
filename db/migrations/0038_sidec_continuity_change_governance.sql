CREATE TABLE sidec_continuity_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES sidec_continuity_runbook_recommendations(id) ON DELETE CASCADE,
  target_plan_id uuid NOT NULL REFERENCES sidec_continuity_plans(id) ON DELETE RESTRICT,
  proposal_text text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PROPOSED'
    CHECK(status IN ('PROPOSED','APPLIED','VERIFIED','CANCELLED')),
  applied_by uuid REFERENCES users(id),
  applied_at timestamptz,
  verification_exercise_id uuid REFERENCES sidec_continuity_exercises(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sidec_continuity_change_proposals_active_uidx
  ON sidec_continuity_change_proposals(recommendation_id)
  WHERE status<>'CANCELLED';

CREATE INDEX sidec_continuity_change_proposals_org_idx
  ON sidec_continuity_change_proposals(organization_id,status,created_at DESC);

CREATE TABLE sidec_continuity_change_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_proposals(id) ON DELETE CASCADE,
  evidence_type varchar(20) NOT NULL
    CHECK(evidence_type IN ('NOTE','LINK','DOCUMENT','HASH')),
  title varchar(240) NOT NULL,
  reference text NOT NULL,
  content_hash char(64),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX sidec_continuity_change_evidence_proposal_idx
  ON sidec_continuity_change_evidence(proposal_id,created_at);

COMMENT ON TABLE sidec_continuity_change_proposals IS
  'Propostas humanas e auditáveis que ligam recomendação aceita a uma revisão específica do runbook; não alteram o runbook automaticamente.';
COMMENT ON TABLE sidec_continuity_change_evidence IS
  'Evidências apresentadas pelo operador para demonstrar a implementação da proposta em revisão controlada do runbook.';
