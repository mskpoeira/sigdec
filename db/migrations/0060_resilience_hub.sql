CREATE TABLE IF NOT EXISTS external_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope varchar(20) NOT NULL CHECK(scope IN ('STATE','FEDERAL','MUTUAL_AID','OTHER')),
  service_type varchar(40) NOT NULL CHECK(service_type IN (
    'STATE_HUMANITARIAN','STATE_EMERGENCY_INSPECTION','STATE_KIT_CHUVAS','STATE_KIT_ESTIAGEM',
    'STATE_KIT_FRIO','STATE_EMERGENCY_SUPPORT','STATE_WORKS','STATE_EQUIPMENT_CONVENTION',
    'FEDERAL_RECOGNITION','FEDERAL_ASSISTANCE','FEDERAL_RESTORATION','FEDERAL_RECONSTRUCTION',
    'FEDERAL_HOUSING','FEDERAL_WATER_SUPPLY','MUTUAL_AID','OTHER'
  )),
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  anomaly_case_id uuid REFERENCES abnormal_situation_cases(id) ON DELETE SET NULL,
  cobrade_code varchar(30),
  title text NOT NULL,
  summary text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK(status IN (
    'DRAFT','DOCUMENTING','READY_TO_SUBMIT','SUBMITTED','UNDER_REVIEW','REQUIREMENTS',
    'APPROVED','PARTIAL_APPROVED','REJECTED','EXECUTION','CLOSED','CANCELLED'
  )),
  external_system varchar(80),
  external_protocol varchar(200),
  reference_url text,
  requested_amount numeric(16,2) CHECK(requested_amount IS NULL OR requested_amount>=0),
  approved_amount numeric(16,2) CHECK(approved_amount IS NULL OR approved_amount>=0),
  deadline_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  responsible_user_id uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_support_requests_org_status_idx
  ON external_support_requests(organization_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS external_support_requests_org_type_idx
  ON external_support_requests(organization_id,scope,service_type,updated_at DESC);

CREATE TABLE IF NOT EXISTS external_support_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES external_support_requests(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'MISSING'
    CHECK(status IN ('MISSING','READY','SUBMITTED','ACCEPTED','REJECTED','NOT_APPLICABLE')),
  due_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,code)
);

CREATE INDEX IF NOT EXISTS external_support_requirements_request_idx
  ON external_support_requirements(request_id,status,due_at);

CREATE TABLE IF NOT EXISTS external_support_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES external_support_requests(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL CHECK(event_type IN (
    'CREATED','STATUS_CHANGED','PROTOCOL_RECORDED','REQUIREMENT_ADDED','REQUIREMENT_UPDATED',
    'AMOUNT_UPDATED','DEADLINE_UPDATED','NOTE','EXECUTION_UPDATE','CLOSED'
  )),
  from_status varchar(30),
  to_status varchar(30),
  notes text,
  external_protocol varchar(200),
  amount numeric(16,2),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_support_events_request_idx
  ON external_support_events(request_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  title text NOT NULL,
  provider text,
  category varchar(50) NOT NULL DEFAULT 'OTHER'
    CHECK(category IN ('SIDEC','S2ID','PLANCON','SCO','FIELD_INSPECTION','ALERTS','RADIO','FIRST_AID','FIRE','LOGISTICS','HUMANITARIAN','OTHER')),
  workload_hours numeric(8,2) CHECK(workload_hours IS NULL OR workload_hours>=0),
  validity_months integer CHECK(validity_months IS NULL OR validity_months>0),
  mandatory boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES training_courses(id) ON DELETE RESTRICT,
  person_type varchar(20) NOT NULL CHECK(person_type IN ('USER','VOLUNTEER')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  volunteer_id uuid REFERENCES volunteers(id) ON DELETE CASCADE,
  completed_at date NOT NULL,
  expires_at date,
  certificate_number varchar(150),
  certificate_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(
    (person_type='USER' AND user_id IS NOT NULL AND volunteer_id IS NULL) OR
    (person_type='VOLUNTEER' AND volunteer_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS training_records_org_expiry_idx
  ON training_records(organization_id,expires_at);

CREATE TABLE IF NOT EXISTS mutual_aid_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_name text NOT NULL,
  partner_type varchar(30) NOT NULL CHECK(partner_type IN ('MUNICIPALITY','STATE','FEDERAL','FIRE_DEPARTMENT','NGO','PRIVATE','UTILITY','OTHER')),
  agreement_reference varchar(200),
  starts_at date,
  ends_at date,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED','EXPIRED','CLOSED')),
  liability_terms text,
  reimbursement_terms text,
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mutual_aid_agreements_org_status_idx
  ON mutual_aid_agreements(organization_id,status,ends_at);

CREATE TABLE IF NOT EXISTS mutual_aid_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES mutual_aid_agreements(id) ON DELETE CASCADE,
  resource_type varchar(30) NOT NULL CHECK(resource_type IN ('PERSONNEL','TEAM','VEHICLE','EQUIPMENT','FACILITY','SUPPLY','SERVICE','OTHER')),
  resource_name text NOT NULL,
  capability_type text,
  quantity numeric(12,2) CHECK(quantity IS NULL OR quantity>=0),
  unit varchar(40),
  lead_time_minutes integer CHECK(lead_time_minutes IS NULL OR lead_time_minutes>=0),
  availability_notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mutual_aid_resources_agreement_idx
  ON mutual_aid_resources(agreement_id,active,resource_type);

CREATE TABLE IF NOT EXISTS seasonal_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  title text NOT NULL,
  operation_type varchar(30) NOT NULL CHECK(operation_type IN ('CHUVAS','ESTIAGEM','FRIO','RESSACA','INCENDIOS','EVENTOS_EXTREMOS','MASS_EVENT','OTHER')),
  plan_id uuid REFERENCES contingency_plans(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','SUSPENDED','CLOSED')),
  objective text,
  coordinator text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at),
  UNIQUE(organization_id,code)
);

CREATE INDEX IF NOT EXISTS seasonal_operations_org_status_idx
  ON seasonal_operations(organization_id,status,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS seasonal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES seasonal_operations(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK(sequence_no>0),
  title text NOT NULL,
  frequency varchar(20) NOT NULL DEFAULT 'ONCE' CHECK(frequency IN ('ONCE','SHIFT','DAILY','WEEKLY','EVENT')),
  required boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,sequence_no)
);

CREATE TABLE IF NOT EXISTS seasonal_checklist_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES seasonal_operations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES seasonal_checklist_items(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL CHECK(status IN ('DONE','NOT_APPLICABLE','REOPENED')),
  notes text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seasonal_checklist_events_operation_idx
  ON seasonal_checklist_events(operation_id,item_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS preparedness_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  title text NOT NULL,
  exercise_type varchar(30) NOT NULL CHECK(exercise_type IN ('TABLETOP','DRILL','FUNCTIONAL','FULL_SCALE','SEMINAR','WORKSHOP')),
  plan_id uuid REFERENCES contingency_plans(id) ON DELETE SET NULL,
  seasonal_operation_id uuid REFERENCES seasonal_operations(id) ON DELETE SET NULL,
  scenario text NOT NULL,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','RUNNING','COMPLETED','CANCELLED')),
  evaluator text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE INDEX IF NOT EXISTS preparedness_exercises_org_status_idx
  ON preparedness_exercises(organization_id,status,scheduled_at DESC);

CREATE TABLE IF NOT EXISTS exercise_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES preparedness_exercises(id) ON DELETE CASCADE,
  capability text NOT NULL,
  objective text NOT NULL,
  target text,
  result varchar(20) NOT NULL CHECK(result IN ('MET','PARTIAL','NOT_MET','OBSERVATION')),
  evidence text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exercise_evaluations_exercise_idx
  ON exercise_evaluations(exercise_id,created_at);

CREATE TABLE IF NOT EXISTS exercise_improvement_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES preparedness_exercises(id) ON DELETE CASCADE,
  title text NOT NULL,
  corrective_action text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  due_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','DONE','VERIFIED','CANCELLED')),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exercise_improvement_actions_status_idx
  ON exercise_improvement_actions(organization_id,status,due_at);

CREATE OR REPLACE FUNCTION sigdec_prevent_resilience_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Histórico operacional de resiliência é append-only e não pode ser alterado ou excluído';
END;
$$;

DROP TRIGGER IF EXISTS external_support_events_immutable ON external_support_events;
CREATE TRIGGER external_support_events_immutable
BEFORE UPDATE OR DELETE ON external_support_events
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_resilience_event_mutation();

DROP TRIGGER IF EXISTS external_support_events_no_truncate ON external_support_events;
CREATE TRIGGER external_support_events_no_truncate
BEFORE TRUNCATE ON external_support_events
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_resilience_event_mutation();

DROP TRIGGER IF EXISTS seasonal_checklist_events_immutable ON seasonal_checklist_events;
CREATE TRIGGER seasonal_checklist_events_immutable
BEFORE UPDATE OR DELETE ON seasonal_checklist_events
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_resilience_event_mutation();

DROP TRIGGER IF EXISTS seasonal_checklist_events_no_truncate ON seasonal_checklist_events;
CREATE TRIGGER seasonal_checklist_events_no_truncate
BEFORE TRUNCATE ON seasonal_checklist_events
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_resilience_event_mutation();

INSERT INTO permissions(code,description) VALUES
('support_requests.manage','Gerenciar solicitações estaduais, federais e apoio mútuo'),
('training.manage','Gerenciar capacitações, certificados e credenciais operacionais'),
('mutual_aid.manage','Gerenciar acordos e recursos de ajuda mútua'),
('seasonal_operations.manage','Gerenciar operações sazonais e prontidão periódica'),
('exercises.manage','Gerenciar simulados, avaliações e planos de melhoria')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code IN (
  'support_requests.manage','training.manage','mutual_aid.manage','seasonal_operations.manage','exercises.manage'
)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE external_support_requests IS
  'Controle municipal de solicitações estaduais, federais e de ajuda mútua. Não representa protocolo automático em sistema externo.';
COMMENT ON TABLE training_records IS
  'Capacitações e certificados de servidores e voluntários, com validade e rastreabilidade.';
COMMENT ON TABLE mutual_aid_agreements IS
  'Acordos de ajuda mútua e capacidades externas disponíveis à Defesa Civil.';
COMMENT ON TABLE seasonal_operations IS
  'Operações sazonais de preparação e resposta, vinculáveis a PLANCON.';
COMMENT ON TABLE preparedness_exercises IS
  'Simulados e exercícios de preparação com avaliação e plano de melhoria no modelo AAR/IP.';
