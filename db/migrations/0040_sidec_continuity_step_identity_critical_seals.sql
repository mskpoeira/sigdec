ALTER TABLE sidec_continuity_steps
  ADD COLUMN IF NOT EXISTS lineage_key uuid NOT NULL DEFAULT gen_random_uuid();

WITH seeds AS (
  SELECT DISTINCT ON (p.organization_id,s.phase,s.sort_order)
    p.organization_id,s.phase,s.sort_order,s.lineage_key
  FROM sidec_continuity_steps s
  JOIN sidec_continuity_plans p ON p.id=s.plan_id
  ORDER BY p.organization_id,s.phase,s.sort_order,p.version,s.created_at
)
UPDATE sidec_continuity_steps s
SET lineage_key=seed.lineage_key
FROM sidec_continuity_plans p
JOIN seeds seed
  ON seed.organization_id=p.organization_id
WHERE s.plan_id=p.id
  AND s.phase=seed.phase
  AND s.sort_order=seed.sort_order
  AND s.lineage_key<>seed.lineage_key;

CREATE UNIQUE INDEX IF NOT EXISTS sidec_continuity_steps_plan_lineage_uidx
  ON sidec_continuity_steps(plan_id,lineage_key);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES sidec_continuity_change_proposals(id) ON DELETE CASCADE,
  decision varchar(20) NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
  notes text NOT NULL,
  decided_by uuid NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposal_id,decided_by)
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_approvals_proposal_idx
  ON sidec_continuity_change_approvals(proposal_id,decision,decided_at);

CREATE TABLE IF NOT EXISTS sidec_continuity_change_report_seals (
  proposal_id uuid PRIMARY KEY REFERENCES sidec_continuity_change_proposals(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_hash char(64) NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
  report_bytes bytea NOT NULL,
  algorithm varchar(40) NOT NULL DEFAULT 'Ed25519' CHECK(algorithm='Ed25519'),
  key_id varchar(80) NOT NULL,
  signature text NOT NULL,
  public_key text NOT NULL,
  public_key_fingerprint char(64) NOT NULL CHECK(public_key_fingerprint ~ '^[a-f0-9]{64}$'),
  sealed_by uuid NOT NULL REFERENCES users(id),
  sealed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sidec_continuity_change_report_seals_org_idx
  ON sidec_continuity_change_report_seals(organization_id,sealed_at DESC);

CREATE OR REPLACE FUNCTION prevent_sidec_continuity_change_report_seal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Relatório de mudança SIDEC selado é imutável';
END;
$$;

DROP TRIGGER IF EXISTS sidec_continuity_change_report_seals_immutable ON sidec_continuity_change_report_seals;
CREATE TRIGGER sidec_continuity_change_report_seals_immutable
BEFORE UPDATE OR DELETE ON sidec_continuity_change_report_seals
FOR EACH ROW EXECUTE FUNCTION prevent_sidec_continuity_change_report_seal_mutation();

COMMENT ON COLUMN sidec_continuity_steps.lineage_key IS
  'Identidade estável da etapa entre revisões do runbook; permite detectar movimentações como modificação em vez de remoção/adição.';
COMMENT ON TABLE sidec_continuity_change_approvals IS
  'Decisões humanas de aprovação ou rejeição de propostas; mudanças críticas exigem duas aprovações distintas antes da aplicação.';
COMMENT ON TABLE sidec_continuity_change_report_seals IS
  'Cópia imutável do PDF final da mudança, com SHA-256 e assinatura Ed25519 verificável independentemente.';

INSERT INTO permissions(code,description) VALUES
('sidec_continuity_change.approve','Aprovar ou rejeitar propostas críticas de mudança do runbook SIDEC'),
('sidec_continuity_change.seal','Selar e verificar o relatório final de mudança do runbook SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_continuity_change.approve','sidec_continuity_change.seal')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;
