ALTER TABLE sidec_continuity_change_impacts
  DROP CONSTRAINT IF EXISTS sidec_continuity_change_impacts_change_type_check;

ALTER TABLE sidec_continuity_change_impacts
  ADD CONSTRAINT sidec_continuity_change_impacts_change_type_check
  CHECK(change_type IN ('ADDED','MODIFIED','REMOVED','SPLIT','MERGED','DERIVED')),
  ADD COLUMN IF NOT EXISTS lineage_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sidec_continuity_step_lineage_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  base_plan_id uuid NOT NULL REFERENCES sidec_continuity_plans(id) ON DELETE CASCADE,
  target_plan_id uuid NOT NULL REFERENCES sidec_continuity_plans(id) ON DELETE CASCADE,
  source_step_id uuid NOT NULL REFERENCES sidec_continuity_steps(id) ON DELETE CASCADE,
  target_step_id uuid NOT NULL REFERENCES sidec_continuity_steps(id) ON DELETE CASCADE,
  relation_type varchar(20) NOT NULL
    CHECK(relation_type IN ('SPLIT','MERGED','DERIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_step_id<>target_step_id),
  UNIQUE(source_step_id,target_step_id)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_step_lineage_links_target_idx
  ON sidec_continuity_step_lineage_links(target_plan_id,target_step_id);
CREATE INDEX IF NOT EXISTS sidec_continuity_step_lineage_links_source_idx
  ON sidec_continuity_step_lineage_links(base_plan_id,source_step_id);

COMMENT ON TABLE sidec_continuity_step_lineage_links IS
  'Linhagem explícita N:N entre etapas de revisões consecutivas do runbook, permitindo divisão, fusão e derivação sem perder rastreabilidade.';
COMMENT ON COLUMN sidec_continuity_change_impacts.lineage_details IS
  'Snapshot da relação de linhagem múltipla usada para explicar impactos SPLIT, MERGED e DERIVED.';
