CREATE TABLE sidec_continuity_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(240) NOT NULL,
  interval_days integer NOT NULL CHECK(interval_days BETWEEN 7 AND 1095),
  next_due_at timestamptz NOT NULL,
  default_scenario text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  enabled boolean NOT NULL DEFAULT true,
  last_exercise_id uuid REFERENCES sidec_continuity_exercises(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_continuity_schedules_org_idx
  ON sidec_continuity_schedules(organization_id,enabled,next_due_at);

CREATE TABLE sidec_continuity_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_scope varchar(20) NOT NULL CHECK(contact_scope IN ('INTERNAL','EXTERNAL')),
  escalation_level smallint NOT NULL CHECK(escalation_level BETWEEN 1 AND 5),
  name varchar(200) NOT NULL,
  role_title varchar(200),
  organization_name varchar(240),
  channel_type varchar(20) NOT NULL CHECK(channel_type IN ('PHONE','EMAIL','RADIO','OTHER')),
  channel_value varchar(500) NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_continuity_contacts_org_idx
  ON sidec_continuity_contacts(organization_id,active,escalation_level,name);

CREATE TABLE sidec_continuity_action_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES sidec_continuity_action_items(id) ON DELETE CASCADE,
  alert_type varchar(20) NOT NULL CHECK(alert_type IN ('DUE_SOON','OVERDUE')),
  due_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  UNIQUE(action_id,alert_type,due_at)
);

CREATE INDEX sidec_continuity_action_alerts_open_idx
  ON sidec_continuity_action_alerts(organization_id,detected_at DESC)
  WHERE acknowledged_at IS NULL;

CREATE TABLE sidec_continuity_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  aar_id uuid NOT NULL REFERENCES sidec_continuity_aars(id) ON DELETE CASCADE,
  category varchar(30) NOT NULL CHECK(category IN (
    'PROCESS','PEOPLE','TECHNOLOGY','COMMUNICATION','DATA','STORAGE','CONNECTIVITY','OTHER'
  )),
  recurrence_key varchar(100) NOT NULL,
  title varchar(240) NOT NULL,
  observation text NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'MEDIUM'
    CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aar_id,recurrence_key)
);

CREATE INDEX sidec_continuity_lessons_org_idx
  ON sidec_continuity_lessons(organization_id,recurrence_key,created_at DESC);

INSERT INTO permissions(code,description) VALUES
('sidec_continuity_schedule.manage','Gerenciar agenda periódica de exercícios SIDEC'),
('sidec_continuity_contacts.manage','Gerenciar matriz de contatos e escalonamento SIDEC'),
('sidec_continuity_lessons.manage','Registrar lições aprendidas estruturadas em AAR SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'sidec_continuity_schedule.manage','sidec_continuity_contacts.manage','sidec_continuity_lessons.manage'
)
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sidec_continuity_schedules IS
  'Agenda administrativa de exercícios controlados de continuidade; não inicia failover automaticamente.';
COMMENT ON TABLE sidec_continuity_contacts IS
  'Matriz de contatos e escalonamento usada pelo plano de continuidade SIDEC.';
COMMENT ON TABLE sidec_continuity_action_alerts IS
  'Alertas idempotentes para ações corretivas próximas do vencimento ou vencidas.';
COMMENT ON TABLE sidec_continuity_lessons IS
  'Lições aprendidas estruturadas para identificar recorrência entre AARs finalizados.';
