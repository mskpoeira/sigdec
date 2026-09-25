ALTER TABLE sidec_continuity_plans
  ADD COLUMN IF NOT EXISTS parent_plan_id uuid REFERENCES sidec_continuity_plans(id) ON DELETE SET NULL;

UPDATE sidec_continuity_plans current
SET parent_plan_id=previous.id
FROM sidec_continuity_plans previous
WHERE current.parent_plan_id IS NULL
  AND previous.organization_id=current.organization_id
  AND previous.version=current.version-1;

CREATE INDEX IF NOT EXISTS sidec_continuity_plans_parent_idx
  ON sidec_continuity_plans(parent_plan_id);

ALTER TABLE sidec_continuity_change_proposals
  ADD COLUMN IF NOT EXISTS base_plan_id uuid REFERENCES sidec_continuity_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS baseline_exercise_id uuid REFERENCES sidec_continuity_exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS diff_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS effectiveness_outcome varchar(20),
  ADD COLUMN IF NOT EXISTS effectiveness_snapshot jsonb;

UPDATE sidec_continuity_change_proposals cp
SET base_plan_id=p.parent_plan_id
FROM sidec_continuity_plans p
WHERE cp.target_plan_id=p.id
  AND cp.base_plan_id IS NULL;

ALTER TABLE sidec_continuity_change_proposals
  DROP CONSTRAINT IF EXISTS sidec_continuity_change_proposals_effectiveness_outcome_check;

ALTER TABLE sidec_continuity_change_proposals
  ADD CONSTRAINT sidec_continuity_change_proposals_effectiveness_outcome_check
  CHECK(effectiveness_outcome IS NULL OR effectiveness_outcome IN ('NO_BASELINE','IMPROVED','STABLE','REGRESSED'));

CREATE TABLE IF NOT EXISTS sidec_continuity_change_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_proposals(id) ON DELETE CASCADE,
  base_step_id uuid REFERENCES sidec_continuity_steps(id) ON DELETE SET NULL,
  target_step_id uuid REFERENCES sidec_continuity_steps(id) ON DELETE SET NULL,
  step_key varchar(80) NOT NULL,
  change_type varchar(20) NOT NULL CHECK(change_type IN ('ADDED','MODIFIED','REMOVED')),
  phase varchar(30) NOT NULL CHECK(phase IN ('DECLARATION','COMMUNICATION','PRESERVATION','RECOVERY','VALIDATION','RETURN')),
  sort_order integer NOT NULL CHECK(sort_order BETWEEN 1 AND 10000),
  title varchar(240) NOT NULL,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(base_step_id IS NOT NULL OR target_step_id IS NOT NULL),
  UNIQUE(proposal_id,step_key,change_type)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_impacts_proposal_idx
  ON sidec_continuity_change_impacts(proposal_id,sort_order);

COMMENT ON COLUMN sidec_continuity_plans.parent_plan_id IS
  'Revisão-base da qual o rascunho foi derivado. Mantém a linhagem entre versões do runbook.';
COMMENT ON COLUMN sidec_continuity_change_proposals.diff_snapshot IS
  'Snapshot auditável das diferenças entre a revisão-base e a revisão-alvo no momento da aplicação.';
COMMENT ON COLUMN sidec_continuity_change_proposals.effectiveness_snapshot IS
  'Comparação auditável entre o exercício-base e o exercício de verificação da revisão-alvo.';
COMMENT ON TABLE sidec_continuity_change_impacts IS
  'Associação explícita entre uma proposta de mudança e as etapas do runbook afetadas pelo diff estrutural.';
