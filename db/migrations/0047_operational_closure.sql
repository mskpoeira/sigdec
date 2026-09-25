ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS pants_size varchar(20),
  ADD COLUMN IF NOT EXISTS jacket_size varchar(20),
  ADD COLUMN IF NOT EXISTS vest_size varchar(20),
  ADD COLUMN IF NOT EXISTS glove_size varchar(20),
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS education text,
  ADD COLUMN IF NOT EXISTS institution text,
  ADD COLUMN IF NOT EXISTS cnh_category varchar(30),
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS radioamateur_call_sign varchar(40),
  ADD COLUMN IF NOT EXISTS operation_region text,
  ADD COLUMN IF NOT EXISTS validated_skills text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS certifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE humanitarian_deliveries
  ADD COLUMN IF NOT EXISTS duplicate_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_reason text;

CREATE INDEX IF NOT EXISTS humanitarian_deliveries_household_time_idx
  ON humanitarian_deliveries(organization_id,household_id,delivered_at DESC)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS humanitarian_delivery_items_item_idx
  ON humanitarian_delivery_items(item_id,delivery_id);

INSERT INTO humanitarian_items(organization_id,code,name,unit,category)
SELECT o.id,v.code,v.name,v.unit,v.category
FROM organizations o
CROSS JOIN (VALUES
 ('CESTA_BASICA','Cesta básica','un','FOOD'),
 ('AGUA','Água potável','un','WATER'),
 ('KIT_HIGIENE','Kit de higiene','un','HYGIENE'),
 ('KIT_LIMPEZA','Kit de limpeza','un','CLEANING'),
 ('COLCHAO','Colchão','un','SHELTER'),
 ('COBERTOR','Cobertor','un','SHELTER'),
 ('ROUPA','Roupa','un','CLOTHING'),
 ('CALCADO','Calçado','par','CLOTHING'),
 ('FRALDA','Fralda','pct','CHILDCARE'),
 ('KIT_INFANTIL','Kit infantil','un','CHILDCARE')
) AS v(code,name,unit,category)
ON CONFLICT(organization_id,code) DO NOTHING;

COMMENT ON COLUMN volunteers.certifications IS
  'Cursos, especializações e certificados: nome, instituição, carga horária, validade e referência de anexo.';
COMMENT ON COLUMN volunteers.history IS
  'Histórico operacional estruturado do voluntário.';
COMMENT ON COLUMN humanitarian_deliveries.duplicate_acknowledged IS
  'Indica que o operador confirmou entrega apesar de alerta de possível duplicidade.';
