CREATE TABLE IF NOT EXISTS operational_job_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  name text NOT NULL,
  employment_type varchar(20) NOT NULL DEFAULT 'OTHER'
    CHECK (employment_type IN ('COMMISSIONED','EFFECTIVE','FUNCTION','OTHER')),
  source_reference text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE INDEX IF NOT EXISTS operational_job_titles_org_active_idx
  ON operational_job_titles(organization_id,active,name);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS vehicle_type varchar(40),
  ADD COLUMN IF NOT EXISTS passenger_capacity integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='vehicles_passenger_capacity_check'
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_passenger_capacity_check
      CHECK (passenger_capacity IS NULL OR passenger_capacity BETWEEN 0 AND 99);
  END IF;
END
$$;

COMMENT ON COLUMN vehicles.vehicle_type IS
  'Tipo operacional do veículo, por exemplo PICKUP, SUV, CAR, VAN, TRUCK, MOTORCYCLE, BOAT, TRAILER ou OTHER.';
COMMENT ON COLUMN vehicles.passenger_capacity IS
  'Quantidade de passageiros além do motorista. A lotação operacional total é passageiro(s) + 1 motorista.';

WITH target_orgs AS (
  SELECT id
  FROM organizations
  WHERE regexp_replace(COALESCE(document_number,''),'[^0-9]','','g')='46482857000196'
     OR lower(name) LIKE '%ubatuba%'
)
INSERT INTO operational_job_titles(organization_id,code,name,employment_type,source_reference)
SELECT o.id,v.code,v.name,v.employment_type,v.source_reference
FROM target_orgs o
CROSS JOIN (VALUES
  ('DGDC_DIRETOR','Diretor de Gestão de Defesa Civil','COMMISSIONED','Lei Municipal nº 4.738/2026'),
  ('DGDC_ASSESSOR','Assessor da Diretoria de Gestão de Defesa Civil','COMMISSIONED','Lei Municipal nº 4.738/2026'),
  ('AGENTE_DEFESA_CIVIL','Agente de Defesa Civil','EFFECTIVE','Concurso Público nº 006/2023 e legislação municipal aplicável')
) AS v(code,name,employment_type,source_reference)
ON CONFLICT(organization_id,code) DO UPDATE SET
  name=EXCLUDED.name,
  employment_type=EXCLUDED.employment_type,
  source_reference=EXCLUDED.source_reference,
  active=true,
  updated_at=now();

WITH target_orgs AS (
  SELECT id
  FROM organizations
  WHERE regexp_replace(COALESCE(document_number,''),'[^0-9]','','g')='46482857000196'
     OR lower(name) LIKE '%ubatuba%'
)
INSERT INTO teams(organization_id,code,name,status,active)
SELECT o.id,v.code,v.name,'AVAILABLE',true
FROM target_orgs o
CROSS JOIN (VALUES
  ('DC-DIRECAO','Direção da Defesa Civil'),
  ('DC-ASSESSORIA','Assessoria da Defesa Civil'),
  ('DC-OPERACOES','Equipe Operacional da Defesa Civil')
) AS v(code,name)
ON CONFLICT(organization_id,code) DO UPDATE SET
  name=EXCLUDED.name,
  active=true;

WITH target_orgs AS (
  SELECT id
  FROM organizations
  WHERE regexp_replace(COALESCE(document_number,''),'[^0-9]','','g')='46482857000196'
     OR lower(name) LIKE '%ubatuba%'
),
codes AS (
  SELECT 'DC-'||lpad(gs::text,3,'0') AS code FROM generate_series(1,7) gs
)
INSERT INTO vehicles(
  organization_id,code,description,status,active,vehicle_type,passenger_capacity
)
SELECT o.id,c.code,'Viatura Defesa Civil '||c.code,'AVAILABLE',true,'OTHER',NULL
FROM target_orgs o CROSS JOIN codes c
ON CONFLICT(organization_id,code) DO NOTHING;

COMMENT ON TABLE operational_job_titles IS
  'Catálogo municipal de cargos e funções operacionais utilizados no SIGDEC. Não substitui o cadastro funcional oficial de RH.';
