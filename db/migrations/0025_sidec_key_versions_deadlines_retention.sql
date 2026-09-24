ALTER TABLE sidec_export_artifacts
  ADD COLUMN IF NOT EXISTS signing_key_id varchar(80) NOT NULL DEFAULT 'legacy-v1';

CREATE TABLE sidec_artifact_retention (
  export_id uuid PRIMARY KEY REFERENCES sidec_export_artifacts(export_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  retention_class varchar(30) NOT NULL DEFAULT 'UNSPECIFIED'
    CHECK(retention_class IN ('UNSPECIFIED','OPERATIONAL','ARCHIVAL','LEGAL_HOLD')),
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  notes text,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(retain_until IS NULL OR retain_until >= created_at)
);

CREATE INDEX sidec_artifact_retention_org_idx
  ON sidec_artifact_retention(organization_id,retention_class,retain_until);

CREATE TABLE sidec_deadline_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  pending_status varchar(40) NOT NULL
    CHECK(pending_status IN ('PACKAGE_READY','AWAITING_PROTOCOL','AWAITING_RETURN','REJECTED')),
  warning_after_hours integer NOT NULL CHECK(warning_after_hours BETWEEN 1 AND 8760),
  severity varchar(20) NOT NULL DEFAULT 'WARNING'
    CHECK(severity IN ('WATCH','WARNING','EMERGENCY')),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sidec_deadline_policies_global_unique
  ON sidec_deadline_policies(pending_status)
  WHERE organization_id IS NULL;
CREATE UNIQUE INDEX sidec_deadline_policies_org_unique
  ON sidec_deadline_policies(organization_id,pending_status)
  WHERE organization_id IS NOT NULL;

INSERT INTO sidec_deadline_policies(organization_id,pending_status,warning_after_hours,severity,enabled)
VALUES
(NULL,'PACKAGE_READY',24,'WATCH',true),
(NULL,'AWAITING_PROTOCOL',24,'WARNING',true),
(NULL,'AWAITING_RETURN',72,'WARNING',true),
(NULL,'REJECTED',8,'EMERGENCY',true)
ON CONFLICT DO NOTHING;

CREATE TABLE sidec_deadline_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  export_id uuid NOT NULL REFERENCES sidec_exports(id) ON DELETE CASCADE,
  pending_status varchar(40) NOT NULL,
  severity varchar(20) NOT NULL CHECK(severity IN ('WATCH','WARNING','EMERGENCY')),
  due_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  UNIQUE(organization_id,export_id,pending_status,due_at)
);

CREATE INDEX sidec_deadline_alerts_open_idx
  ON sidec_deadline_alerts(organization_id,detected_at DESC)
  WHERE acknowledged_at IS NULL;

INSERT INTO permissions(code,description) VALUES
('sidec_deadlines.manage','Configurar e reconhecer alertas de prazo operacional SIDEC'),
('sidec_retention.manage','Gerenciar metadados de retenção dos artefatos SIDEC')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN ('sidec_deadlines.manage','sidec_retention.manage')
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN sidec_export_artifacts.signing_key_id IS
  'Identificador lógico da chave HMAC usada para assinar o manifesto; o segredo não é armazenado no banco.';
COMMENT ON TABLE sidec_artifact_retention IS
  'Metadados de retenção separados do ZIP imutável; não alteram os bytes nem a assinatura do artefato.';
COMMENT ON TABLE sidec_deadline_policies IS
  'SLAs operacionais configuráveis do fluxo SIDEC; não representam prazo legal ou normativo.';
COMMENT ON TABLE sidec_deadline_alerts IS
  'Alertas idempotentes gerados quando um estado de interoperabilidade excede o SLA operacional configurado.';
