ALTER TABLE technical_documents
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS legal_basis text,
  ADD COLUMN IF NOT EXISTS recipient text,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash char(64),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE technical_documents DROP CONSTRAINT IF EXISTS technical_documents_status_check;
ALTER TABLE technical_documents
  ADD CONSTRAINT technical_documents_status_check
  CHECK(status IN ('DRAFT','REVIEW','APPROVED','ISSUED','CANCELLED'));

CREATE UNIQUE INDEX IF NOT EXISTS technical_documents_org_number_unique
  ON technical_documents(organization_id, number)
  WHERE number IS NOT NULL;

CREATE TABLE IF NOT EXISTS technical_document_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  document_type varchar(40) NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id, year, document_type)
);

CREATE TABLE IF NOT EXISTS technical_document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(60) NOT NULL,
  name text NOT NULL,
  document_type varchar(40) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  default_title text NOT NULL,
  default_content text NOT NULL,
  default_legal_basis text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT technical_document_templates_type_check CHECK(
    document_type IN ('REPORT','OPINION','INTERDICTION','DECLARATION','FORM','OTHER')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS technical_document_templates_global_unique
  ON technical_document_templates(code, version)
  WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS technical_document_templates_org_unique
  ON technical_document_templates(organization_id, code, version)
  WHERE organization_id IS NOT NULL;

ALTER TABLE technical_document_versions
  ADD COLUMN IF NOT EXISTS content_hash char(64),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS technical_document_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES technical_documents(id) ON DELETE CASCADE,
  signature_type varchar(20) NOT NULL,
  signed_by uuid NOT NULL REFERENCES users(id),
  content_hash char(64) NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  note text,
  CONSTRAINT technical_document_signature_type_check CHECK(
    signature_type IN ('APPROVAL','ISSUANCE','CANCELLATION')
  )
);

CREATE INDEX IF NOT EXISTS technical_document_signatures_document_idx
  ON technical_document_signatures(document_id, signed_at);
CREATE INDEX IF NOT EXISTS technical_document_versions_document_idx
  ON technical_document_versions(document_id, version_no DESC);

INSERT INTO technical_document_templates
  (organization_id, code, name, document_type, default_title, default_content, default_legal_basis)
VALUES
  (NULL, 'VISTORIA', 'Relatório de vistoria', 'REPORT',
   'Relatório técnico de vistoria',
   '1. IDENTIFICAÇÃO\n\n2. OBJETO DA VISTORIA\n\n3. CONSTATAÇÕES TÉCNICAS\n\n4. AVALIAÇÃO DE RISCO\n\n5. MEDIDAS RECOMENDADAS\n\n6. CONCLUSÃO',
   'Lei Federal nº 12.608/2012 e legislação municipal aplicável.'),
  (NULL, 'PARECER', 'Parecer técnico', 'OPINION',
   'Parecer técnico',
   'I. RELATÓRIO\n\nII. ANÁLISE TÉCNICA\n\nIII. FUNDAMENTAÇÃO\n\nIV. CONCLUSÃO',
   'Lei Federal nº 12.608/2012 e normas técnicas aplicáveis.'),
  (NULL, 'INTERDICAO', 'Auto de interdição', 'INTERDICTION',
   'Auto de interdição preventiva',
   '1. IMÓVEL OU ÁREA\n\n2. SITUAÇÃO CONSTATADA\n\n3. RISCO IDENTIFICADO\n\n4. DETERMINAÇÃO\n\n5. CONDIÇÕES PARA DESINTERDIÇÃO',
   'Poder de polícia administrativa e legislação de proteção e defesa civil aplicável.'),
  (NULL, 'DECLARACAO', 'Declaração da Defesa Civil', 'DECLARATION',
   'Declaração',
   'A Coordenadoria Municipal de Proteção e Defesa Civil declara, para os devidos fins, que:',
   'Lei Federal nº 12.608/2012.'),
  (NULL, 'RELATORIO_OCORRENCIA', 'Relatório de ocorrência', 'REPORT',
   'Relatório de atendimento de ocorrência',
   '1. DADOS DA OCORRÊNCIA\n\n2. RECURSOS EMPREGADOS\n\n3. PROVIDÊNCIAS ADOTADAS\n\n4. RESULTADO\n\n5. OBSERVAÇÕES',
   'Lei Federal nº 12.608/2012.')
ON CONFLICT DO NOTHING;

INSERT INTO permissions(code, description) VALUES
  ('documents.review', 'Revisar e devolver documentos técnicos'),
  ('documents.approve', 'Aprovar documentos técnicos'),
  ('documents.templates.manage', 'Gerenciar modelos de documentos técnicos')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'MASTER'
  AND p.code IN ('documents.review','documents.approve','documents.templates.manage')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE technical_document_signatures IS
  'Assinaturas eletrônicas internas vinculadas à sessão, usuário e hash do conteúdo; não equivalem, por si só, a certificado ICP-Brasil.';
