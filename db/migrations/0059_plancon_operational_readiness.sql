CREATE TABLE IF NOT EXISTS plancon_call_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK(sequence_no>0),
  target_name text NOT NULL,
  organization_name text,
  role_name text,
  contact text,
  channel varchar(20) NOT NULL DEFAULT 'OTHER'
    CHECK(channel IN ('PHONE','WHATSAPP','RADIO','EMAIL','OTHER')),
  required boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,sequence_no)
);

CREATE INDEX IF NOT EXISTS plancon_call_targets_plan_idx
  ON plancon_call_targets(plan_id,sequence_no);

INSERT INTO plancon_call_targets(organization_id,plan_id,sequence_no,target_name,created_by)
SELECT p.organization_id,p.id,x.ord::int,x.value,p.created_by
FROM contingency_plans p
CROSS JOIN LATERAL jsonb_array_elements_text(p.call_plan) WITH ORDINALITY AS x(value,ord)
WHERE NOT EXISTS(SELECT 1 FROM plancon_call_targets t WHERE t.plan_id=p.id);

CREATE TABLE IF NOT EXISTS plancon_call_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  activation_id bigint NOT NULL REFERENCES contingency_plan_activations(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES plancon_call_targets(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL CHECK(status IN ('CALLED','ACKNOWLEDGED','UNREACHABLE','SKIPPED','RESET')),
  notes text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plancon_call_events_activation_idx
  ON plancon_call_events(activation_id,target_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS plancon_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  level varchar(20) NOT NULL
    CHECK(level IN ('NORMAL','OBSERVATION','ATTENTION','ALERT','EMERGENCY')),
  sequence_no integer NOT NULL CHECK(sequence_no>0),
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,level,sequence_no)
);

CREATE INDEX IF NOT EXISTS plancon_checklist_items_plan_level_idx
  ON plancon_checklist_items(plan_id,level,sequence_no);

INSERT INTO plancon_checklist_items(organization_id,plan_id,level,sequence_no,title,created_by)
SELECT p.organization_id,p.id,'EMERGENCY',x.ord::int,x.value,p.created_by
FROM contingency_plans p
CROSS JOIN LATERAL jsonb_array_elements_text(p.procedures) WITH ORDINALITY AS x(value,ord)
WHERE NOT EXISTS(SELECT 1 FROM plancon_checklist_items i WHERE i.plan_id=p.id);

CREATE TABLE IF NOT EXISTS plancon_checklist_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  activation_id bigint NOT NULL REFERENCES contingency_plan_activations(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES plancon_checklist_items(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL CHECK(status IN ('DONE','NOT_APPLICABLE','REOPENED')),
  notes text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plancon_checklist_events_activation_idx
  ON plancon_checklist_events(activation_id,item_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS plancon_resource_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  activation_id bigint NOT NULL REFERENCES contingency_plan_activations(id) ON DELETE RESTRICT,
  resource_type varchar(20) NOT NULL CHECK(resource_type IN ('TEAM','VEHICLE','INVENTORY','COMMUNICATION','MANUAL')),
  resource_id uuid,
  resource_label text NOT NULL,
  event_type varchar(20) NOT NULL CHECK(event_type IN ('MOBILIZED','DEMOBILIZED')),
  quantity numeric(12,2),
  unit varchar(30),
  notes text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_matricula varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plancon_resource_events_activation_idx
  ON plancon_resource_events(activation_id,resource_type,resource_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS plancon_incident_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  activation_id bigint NOT NULL REFERENCES contingency_plan_activations(id) ON DELETE RESTRICT,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES users(id),
  linked_by_matricula varchar(32) NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,activation_id,incident_id)
);

CREATE INDEX IF NOT EXISTS plancon_incident_links_activation_idx
  ON plancon_incident_links(activation_id,linked_at DESC);

CREATE OR REPLACE FUNCTION sigdec_prevent_plancon_operational_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Histórico operacional do PLANCON é append-only e não pode ser alterado ou excluído';
END;
$$;

DROP TRIGGER IF EXISTS plancon_call_events_immutable ON plancon_call_events;
CREATE TRIGGER plancon_call_events_immutable
BEFORE UPDATE OR DELETE ON plancon_call_events
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_checklist_events_immutable ON plancon_checklist_events;
CREATE TRIGGER plancon_checklist_events_immutable
BEFORE UPDATE OR DELETE ON plancon_checklist_events
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_resource_events_immutable ON plancon_resource_events;
CREATE TRIGGER plancon_resource_events_immutable
BEFORE UPDATE OR DELETE ON plancon_resource_events
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_incident_links_immutable ON plancon_incident_links;
CREATE TRIGGER plancon_incident_links_immutable
BEFORE UPDATE OR DELETE ON plancon_incident_links
FOR EACH ROW EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_call_events_no_truncate ON plancon_call_events;
CREATE TRIGGER plancon_call_events_no_truncate
BEFORE TRUNCATE ON plancon_call_events
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_checklist_events_no_truncate ON plancon_checklist_events;
CREATE TRIGGER plancon_checklist_events_no_truncate
BEFORE TRUNCATE ON plancon_checklist_events
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_resource_events_no_truncate ON plancon_resource_events;
CREATE TRIGGER plancon_resource_events_no_truncate
BEFORE TRUNCATE ON plancon_resource_events
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

DROP TRIGGER IF EXISTS plancon_incident_links_no_truncate ON plancon_incident_links;
CREATE TRIGGER plancon_incident_links_no_truncate
BEFORE TRUNCATE ON plancon_incident_links
FOR EACH STATEMENT EXECUTE FUNCTION sigdec_prevent_plancon_operational_event_mutation();

COMMENT ON TABLE plancon_call_targets IS
  'Plano de chamada executável do PLANCON, preservado por versão do plano.';
COMMENT ON TABLE plancon_call_events IS
  'Histórico append-only dos acionamentos e confirmações do plano de chamada.';
COMMENT ON TABLE plancon_checklist_items IS
  'Checklist operacional por nível do PLANCON.';
COMMENT ON TABLE plancon_resource_events IS
  'Mobilização e desmobilização de equipes, viaturas, estoque, comunicações e recursos manuais.';
COMMENT ON TABLE plancon_incident_links IS
  'Vínculo auditável entre ocorrências SIGDEC e uma ativação do PLANCON.';
