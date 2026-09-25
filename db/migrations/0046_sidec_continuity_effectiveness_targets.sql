CREATE TABLE IF NOT EXISTS sidec_continuity_effectiveness_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type varchar(20) NOT NULL CHECK(scope_type IN ('DEFAULT','CATEGORY','RECURRENCE')),
  scope_value varchar(120) NOT NULL,
  min_verified_rate numeric(5,2) CHECK(min_verified_rate IS NULL OR (min_verified_rate BETWEEN 0 AND 100)),
  min_improved_rate numeric(5,2) CHECK(min_improved_rate IS NULL OR (min_improved_rate BETWEEN 0 AND 100)),
  max_avg_apply_hours numeric(10,2) CHECK(max_avg_apply_hours IS NULL OR max_avg_apply_hours>0),
  max_avg_verification_hours numeric(10,2) CHECK(max_avg_verification_hours IS NULL OR max_avg_verification_hours>0),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,scope_type,scope_value),
  CHECK(
    min_verified_rate IS NOT NULL OR min_improved_rate IS NOT NULL OR
    max_avg_apply_hours IS NOT NULL OR max_avg_verification_hours IS NOT NULL
  ),
  CHECK(
    (scope_type='DEFAULT' AND scope_value='*') OR
    (scope_type<>'DEFAULT' AND length(trim(scope_value))>=2)
  )
);

CREATE INDEX IF NOT EXISTS sidec_continuity_effectiveness_targets_org_idx
  ON sidec_continuity_effectiveness_targets(organization_id,enabled,scope_type,scope_value);

COMMENT ON TABLE sidec_continuity_effectiveness_targets IS
  'Metas administrativas quantitativas para governança de mudanças do runbook. São indicadores internos e não representam SLA legal ou contratual.';
