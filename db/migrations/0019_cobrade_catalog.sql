CREATE TABLE cobrade_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  name text NOT NULL,
  group_name text,
  subgroup_name text,
  type_name text,
  subtype_name text,
  source_name text,
  source_version text,
  active boolean NOT NULL DEFAULT true,
  imported_by uuid NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE INDEX cobrade_catalog_org_name_idx
  ON cobrade_catalog(organization_id,name);
CREATE INDEX cobrade_catalog_org_active_idx
  ON cobrade_catalog(organization_id,active,code);

INSERT INTO permissions(code,description) VALUES
('cobrade.manage','Importar e manter catálogo COBRADE')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code='cobrade.manage'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE cobrade_catalog IS
  'Catálogo COBRADE importado pela organização com rastreabilidade de fonte e versão.';
