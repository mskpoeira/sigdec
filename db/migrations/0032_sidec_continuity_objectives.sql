CREATE TABLE sidec_resilience_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  rpo_minutes integer NOT NULL DEFAULT 1440 CHECK(rpo_minutes BETWEEN 15 AND 10080),
  rto_minutes integer NOT NULL DEFAULT 240 CHECK(rto_minutes BETWEEN 15 AND 43200),
  drill_max_age_hours integer NOT NULL DEFAULT 168 CHECK(drill_max_age_hours BETWEEN 24 AND 8760),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sidec_resilience_policies(organization_id)
SELECT id FROM organizations
ON CONFLICT(organization_id) DO NOTHING;

COMMENT ON TABLE sidec_resilience_policies IS
  'Objetivos administrativos de continuidade para a preservação SIDEC. RPO é confrontado com atraso de replicação; RTO é confrontado apenas com evidência de drill de restauração, não com recuperação integral do SIGDEC.';
