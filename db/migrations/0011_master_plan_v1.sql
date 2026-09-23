CREATE TABLE risk_registers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code text NOT NULL, title text NOT NULL, category text NOT NULL, probability smallint NOT NULL CHECK(probability BETWEEN 1 AND 5),
 impact smallint NOT NULL CHECK(impact BETWEEN 1 AND 5), status text NOT NULL DEFAULT 'ACTIVE', mitigation text,
 location geography(Point,4326), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code)
);
CREATE TABLE alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 risk_id uuid REFERENCES risk_registers(id), severity text NOT NULL CHECK(severity IN ('INFO','WATCH','WARNING','EMERGENCY')),
 title text NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', starts_at timestamptz, ends_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE s2id_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id), cobrade text NOT NULL, record_type text NOT NULL CHECK(record_type IN ('FIDE','DMATE','OTHER')),
 status text NOT NULL DEFAULT 'DRAFT', payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trainings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL, training_type text NOT NULL CHECK(training_type IN ('COURSE','DRILL','SIMULATION','AAR')),
 starts_at timestamptz NOT NULL, ends_at timestamptz, location text, objectives text, findings text, improvement_plan text,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recovery_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id), title text NOT NULL, category text NOT NULL, status text NOT NULL DEFAULT 'PLANNED',
 estimated_cost numeric(14,2), responsible text, due_at timestamptz, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE institutional_library (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 title text NOT NULL, category text NOT NULL, version text, source_url text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL, integration_type text NOT NULL CHECK(integration_type IN ('API','WEBHOOK','IMPORT','EXPORT')),
 endpoint_url text, active boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feature_flags (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, code text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,code)
);
CREATE TABLE assistive_insights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id), insight_type text NOT NULL, summary text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'PROPOSED', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_registers_org_status_idx ON risk_registers(organization_id,status);
CREATE INDEX alerts_org_created_idx ON alerts(organization_id,created_at DESC);
CREATE INDEX s2id_org_created_idx ON s2id_records(organization_id,created_at DESC);
CREATE INDEX recovery_org_status_idx ON recovery_actions(organization_id,status);

INSERT INTO permissions(code,description) VALUES
('risks.manage','Gerenciar cadastro e tratamento de riscos'),('alerts.manage','Gerenciar alertas e protocolos'),
('s2id.manage','Gerenciar registros S2iD, COBRADE, FIDE e DMATE'),('training.manage','Gerenciar treinamentos, simulados e AAR'),
('recovery.manage','Gerenciar recuperação pós-desastre'),('library.manage','Gerenciar biblioteca institucional'),
('integrations.manage','Gerenciar integrações e webhooks'),('bi.read','Consultar indicadores e BI'),
('admin.features','Gerenciar feature flags'),('assistive.read','Consultar inteligência assistiva')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MASTER' AND p.code IN
('risks.manage','alerts.manage','s2id.manage','training.manage','recovery.manage','library.manage','integrations.manage','bi.read','admin.features','assistive.read')
ON CONFLICT DO NOTHING;