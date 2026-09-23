CREATE TABLE communication_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES communication_assets(id),
 assigned_to_user_id uuid REFERENCES users(id),
 assigned_to_name text,
 assigned_at timestamptz NOT NULL DEFAULT now(),
 returned_at timestamptz,
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 CONSTRAINT communication_assignment_target_check CHECK(assigned_to_user_id IS NOT NULL OR assigned_to_name IS NOT NULL)
);
CREATE INDEX communication_assignments_asset_idx ON communication_assignments(asset_id,assigned_at DESC);

CREATE TABLE technical_document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES technical_documents(id) ON DELETE CASCADE,
 version_no integer NOT NULL CHECK(version_no>0),
 content jsonb NOT NULL,
 change_summary text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,version_no)
);

ALTER TABLE operational_periods ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE operational_periods ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE operational_periods ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE operational_periods DROP CONSTRAINT IF EXISTS operational_periods_status_check;
ALTER TABLE operational_periods ADD CONSTRAINT operational_periods_status_check CHECK(status IN ('DRAFT','ACTIVE','CLOSED'));

INSERT INTO permissions(code,description) VALUES
('communications.assign','Realizar cautela e devolução de equipamentos de comunicação'),
('documents.issue','Emitir documentos técnicos'),
('sco.periods.manage','Gerenciar períodos operacionais do SCO')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MASTER' AND p.code IN ('communications.assign','documents.issue','sco.periods.manage')
ON CONFLICT DO NOTHING;