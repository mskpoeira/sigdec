CREATE TABLE IF NOT EXISTS contingency_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(60) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  title text NOT NULL,
  cobrade_code varchar(30),
  scope text,
  objective text,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','APPROVED','ACTIVE','ARCHIVED')),
  current_level varchar(20) NOT NULL DEFAULT 'NORMAL'
    CHECK(current_level IN ('NORMAL','OBSERVATION','ATTENTION','ALERT','EMERGENCY')),
  trigger_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  call_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  shelters_routes jsonb NOT NULL DEFAULT '[]'::jsonb,
  procedures jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code,version)
);

CREATE INDEX IF NOT EXISTS contingency_plans_org_status_idx
  ON contingency_plans(organization_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS contingency_plans_org_cobrade_idx
  ON contingency_plans(organization_id,cobrade_code)
  WHERE cobrade_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS contingency_plan_activations (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  from_level varchar(20) NOT NULL
    CHECK(from_level IN ('NORMAL','OBSERVATION','ATTENTION','ALERT','EMERGENCY')),
  to_level varchar(20) NOT NULL
    CHECK(to_level IN ('NORMAL','OBSERVATION','ATTENTION','ALERT','EMERGENCY')),
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contingency_plan_activations_plan_idx
  ON contingency_plan_activations(plan_id,occurred_at DESC,id DESC);

CREATE OR REPLACE FUNCTION sigdec_prevent_plancon_activation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Histórico de ativação do PLANCON é append-only e não pode ser alterado ou excluído';
END;
$$;

DROP TRIGGER IF EXISTS contingency_plan_activations_immutable ON contingency_plan_activations;
CREATE TRIGGER contingency_plan_activations_immutable
BEFORE UPDATE OR DELETE ON contingency_plan_activations
FOR EACH ROW
EXECUTE FUNCTION sigdec_prevent_plancon_activation_mutation();

DROP TRIGGER IF EXISTS contingency_plan_activations_no_truncate ON contingency_plan_activations;
CREATE TRIGGER contingency_plan_activations_no_truncate
BEFORE TRUNCATE ON contingency_plan_activations
FOR EACH STATEMENT
EXECUTE FUNCTION sigdec_prevent_plancon_activation_mutation();

CREATE TABLE IF NOT EXISTS abnormal_situation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  cobrade_code varchar(30) NOT NULL,
  situation_type varchar(8) NOT NULL CHECK(situation_type IN ('SE','ECP')),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','DOCUMENTING','SUBMITTED','UNDER_REVIEW','RECOGNIZED','REJECTED','CLOSED')),
  summary text NOT NULL,
  decree_number varchar(80),
  decree_date date,
  external_protocol varchar(200),
  deadline_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abnormal_situation_cases_org_status_idx
  ON abnormal_situation_cases(organization_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS abnormal_situation_cases_incident_idx
  ON abnormal_situation_cases(incident_id)
  WHERE incident_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS abnormal_fvd_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES abnormal_situation_cases(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  requirement_type varchar(30) NOT NULL DEFAULT 'OTHER'
    CHECK(requirement_type IN ('FIDE','DMATE','PHOTO_REPORT','DECREE','TECHNICAL_REPORT','OTHER')),
  title text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','RESPONDED','ACCEPTED','REJECTED')),
  due_at timestamptz,
  response_notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,code)
);

CREATE INDEX IF NOT EXISTS abnormal_fvd_items_case_status_idx
  ON abnormal_fvd_items(case_id,status,due_at);

INSERT INTO permissions(code,description) VALUES
('plancon.manage','Gerenciar Plano de Contingência Municipal, níveis de ativação e revisões'),
('anomaly.manage','Gerenciar situação de anormalidade, SE/ECP e pendências documentais')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code IN ('plancon.manage','anomaly.manage')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE contingency_plans IS
  'PLANCON municipal versionado por código, com gatilhos, plano de chamada, recursos, abrigos/rotas e procedimentos operacionais.';
COMMENT ON TABLE contingency_plan_activations IS
  'Histórico append-only das mudanças de nível operacional do PLANCON, com horário oficial e matrícula do servidor.';
COMMENT ON TABLE abnormal_situation_cases IS
  'Processos municipais de Situação de Emergência (SE) e Estado de Calamidade Pública (ECP), sem presumir reconhecimento externo automático.';
COMMENT ON TABLE abnormal_fvd_items IS
  'Pendências e exigências documentais de processos de situação de anormalidade, incluindo FIDE/DMATE e itens de verificação.';
