CREATE TABLE sidec_continuity_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version > 0),
  title varchar(240) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
  activation_criteria text NOT NULL DEFAULT '',
  recovery_strategy text NOT NULL DEFAULT '',
  communication_plan text NOT NULL DEFAULT '',
  return_to_normal text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  activated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(organization_id,version)
);

CREATE UNIQUE INDEX sidec_continuity_plans_active_unique
  ON sidec_continuity_plans(organization_id)
  WHERE status='ACTIVE';

CREATE INDEX sidec_continuity_plans_org_idx
  ON sidec_continuity_plans(organization_id,version DESC);

CREATE TABLE sidec_continuity_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES sidec_continuity_plans(id) ON DELETE CASCADE,
  phase varchar(30) NOT NULL
    CHECK(phase IN ('DECLARATION','COMMUNICATION','PRESERVATION','RECOVERY','VALIDATION','RETURN')),
  sort_order integer NOT NULL CHECK(sort_order BETWEEN 1 AND 10000),
  title varchar(240) NOT NULL,
  instructions text NOT NULL,
  expected_minutes integer NOT NULL DEFAULT 15 CHECK(expected_minutes BETWEEN 1 AND 10080),
  owner_user_id uuid REFERENCES users(id),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,sort_order)
);

CREATE INDEX sidec_continuity_steps_plan_idx
  ON sidec_continuity_steps(plan_id,sort_order);

CREATE TABLE sidec_continuity_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES sidec_continuity_plans(id),
  scenario text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK(status IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
  result varchar(20) CHECK(result IS NULL OR result IN ('PASS','PARTIAL','FAIL')),
  notes text,
  created_by uuid REFERENCES users(id),
  completed_by uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_continuity_exercises_org_idx
  ON sidec_continuity_exercises(organization_id,started_at DESC);

CREATE TABLE sidec_continuity_exercise_steps (
  exercise_id uuid NOT NULL REFERENCES sidec_continuity_exercises(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES sidec_continuity_steps(id),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','COMPLETED','SKIPPED','FAILED')),
  notes text,
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  PRIMARY KEY(exercise_id,step_id)
);

INSERT INTO permissions(code,description) VALUES
('sidec_continuity.read','Consultar plano, runbook e exercícios de continuidade SIDEC'),
('sidec_continuity.manage','Gerenciar versões do runbook e conduzir exercícios de continuidade SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_continuity.read','sidec_continuity.manage')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_continuity_plans IS
  'Versões controladas do plano de continuidade SIDEC. Revisões ACTIVE e RETIRED são imutáveis pela API.';
COMMENT ON TABLE sidec_continuity_steps IS
  'Etapas ordenadas do runbook por fase, com responsável nominal e tempo esperado.';
COMMENT ON TABLE sidec_continuity_exercises IS
  'Exercícios controlados de mesa baseados em um runbook ativo; não executam failover real.';
COMMENT ON TABLE sidec_continuity_exercise_steps IS
  'Registro de execução de cada etapa do runbook durante um exercício de continuidade.';
