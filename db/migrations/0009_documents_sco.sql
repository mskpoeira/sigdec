CREATE TABLE technical_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 inspection_id uuid REFERENCES inspections(id) ON DELETE SET NULL,
 document_type varchar(40) NOT NULL,
 number varchar(80),
 title text NOT NULL,
 status varchar(30) NOT NULL DEFAULT 'DRAFT',
 content jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 issued_at timestamptz,
 CONSTRAINT technical_documents_type_check CHECK(document_type IN ('REPORT','OPINION','INTERDICTION','DECLARATION','FORM','OTHER')),
 CONSTRAINT technical_documents_status_check CHECK(status IN ('DRAFT','ISSUED','CANCELLED'))
);
CREATE INDEX technical_documents_org_idx ON technical_documents(organization_id,created_at DESC);

CREATE TABLE emergency_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 name text NOT NULL,
 status varchar(30) NOT NULL DEFAULT 'ACTIVE',
 command_post text,
 commander_user_id uuid REFERENCES users(id),
 objectives text,
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 CONSTRAINT emergency_operations_status_check CHECK(status IN ('ACTIVE','STANDBY','CLOSED'))
);
CREATE INDEX emergency_operations_org_idx ON emergency_operations(organization_id,started_at DESC);

CREATE TABLE operational_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL REFERENCES emergency_operations(id) ON DELETE CASCADE,
 sequence_no integer NOT NULL CHECK(sequence_no > 0),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz,
 objectives text,
 situation_summary text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operation_id,sequence_no)
);

INSERT INTO permissions(code,description) VALUES
('documents.read','Consultar documentos técnicos'),
('documents.manage','Criar, emitir e cancelar documentos técnicos'),
('sco.read','Consultar operações de emergência e períodos operacionais'),
('sco.manage','Gerenciar operações de emergência e períodos operacionais')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MASTER' AND p.code IN ('documents.read','documents.manage','sco.read','sco.manage')
ON CONFLICT DO NOTHING;