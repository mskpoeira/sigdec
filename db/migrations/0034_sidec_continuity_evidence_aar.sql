CREATE TABLE sidec_continuity_step_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES sidec_continuity_exercises(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES sidec_continuity_steps(id),
  evidence_type varchar(30) NOT NULL
    CHECK(evidence_type IN ('NOTE','LINK','DOCUMENT','HASH')),
  title varchar(240) NOT NULL,
  reference text NOT NULL,
  content_hash char(64),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX sidec_continuity_step_evidence_exercise_idx
  ON sidec_continuity_step_evidence(exercise_id,step_id,created_at);

CREATE TABLE sidec_continuity_aars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL UNIQUE REFERENCES sidec_continuity_exercises(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','FINAL')),
  executive_summary text NOT NULL DEFAULT '',
  strengths text NOT NULL DEFAULT '',
  gaps text NOT NULL DEFAULT '',
  recommendations text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  finalized_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE INDEX sidec_continuity_aars_org_idx
  ON sidec_continuity_aars(organization_id,updated_at DESC);

CREATE TABLE sidec_continuity_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aar_id uuid NOT NULL REFERENCES sidec_continuity_aars(id) ON DELETE CASCADE,
  title varchar(240) NOT NULL,
  description text NOT NULL DEFAULT '',
  priority varchar(20) NOT NULL DEFAULT 'MEDIUM'
    CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  owner_user_id uuid REFERENCES users(id),
  due_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sidec_continuity_action_items_aar_idx
  ON sidec_continuity_action_items(aar_id,status,due_at);

COMMENT ON TABLE sidec_continuity_step_evidence IS
  'Evidências referenciais registradas por etapa do exercício; a v1.27 não faz upload arbitrário de arquivo binário.';
COMMENT ON TABLE sidec_continuity_aars IS
  'After Action Review versionado pelo exercício; conteúdo FINAL é imutável pela API.';
COMMENT ON TABLE sidec_continuity_action_items IS
  'Ações corretivas derivadas do AAR, com responsável, prioridade, prazo e acompanhamento de execução.';
