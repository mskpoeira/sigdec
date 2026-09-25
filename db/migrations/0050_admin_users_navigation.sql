CREATE TABLE IF NOT EXISTS navigation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label varchar(80) NOT NULL,
  path varchar(120) NOT NULL,
  permission_code varchar(120) REFERENCES permissions(code),
  sort_order integer NOT NULL DEFAULT 100 CHECK(sort_order BETWEEN 0 AND 1000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS navigation_items_org_idx ON navigation_items(organization_id,active,sort_order);

INSERT INTO roles(code,name,level,system_role) VALUES
 ('OPERADOR_199','Operador da Central 199',20,false),
 ('CAMPO','Equipe de Campo',20,false),
 ('ASSISTENCIA','Assistência Humanitária',20,false),
 ('COORDENACAO','Coordenação Operacional',60,false)
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON
 (r.code='OPERADOR_199' AND (p.code LIKE 'incidents.%' OR p.code LIKE 'dispatch.%')) OR
 (r.code='CAMPO' AND (p.code LIKE 'field.%' OR p.code LIKE 'inspections.%' OR p.code='incidents.read')) OR
 (r.code='ASSISTENCIA' AND (p.code LIKE 'humanitarian.%' OR p.code LIKE 'volunteers.%')) OR
 (r.code='COORDENACAO' AND (p.code LIKE 'incidents.%' OR p.code LIKE 'dispatch.%' OR
   p.code LIKE 'field.%' OR p.code LIKE 'inspections.%' OR p.code LIKE 'humanitarian.%' OR
   p.code LIKE 'volunteers.%' OR p.code LIKE 'monitoring.%' OR p.code LIKE 'alerts.%' OR
   p.code LIKE 'sco.%' OR p.code LIKE 'documents.read'))
ON CONFLICT DO NOTHING;
