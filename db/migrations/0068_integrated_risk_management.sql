-- SIGDEC v1.70 — ciclo integrado de gestão do risco e do desastre

INSERT INTO permissions(code,description) VALUES
('risk_management.read','Consultar gestão territorial de riscos, alertas, mitigação e NUDEC'),
('risk_management.manage','Gerenciar áreas de risco, alertas, mitigação e NUDEC'),
('damages.read','Consultar avaliação de danos, custos e lições aprendidas'),
('damages.manage','Gerenciar avaliação de danos, custos e lições aprendidas'),
('infrastructure.read','Consultar infraestruturas críticas e prontidão de recursos'),
('infrastructure.manage','Gerenciar infraestruturas críticas e prontidão de recursos'),
('animals.read','Consultar animais afetados por desastres'),
('animals.manage','Gerenciar animais afetados por desastres'),
('sco.action_plan.manage','Gerenciar itens do Plano de Ação do Incidente')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code IN(
 'risk_management.read','risk_management.manage','damages.read','damages.manage',
 'infrastructure.read','infrastructure.manage','animals.read','animals.manage','sco.action_plan.manage'
)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS territorial_risk_areas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code varchar(80) NOT NULL,
 name varchar(240) NOT NULL,
 neighborhood varchar(160),
 hazard_type varchar(80) NOT NULL,
 risk_level varchar(10) NOT NULL DEFAULT 'R2' CHECK(risk_level IN('R1','R2','R3','R4')),
 pmrr_reference varchar(200),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','MITIGATED','MONITORING','INACTIVE')),
 exposed_buildings integer NOT NULL DEFAULT 0 CHECK(exposed_buildings>=0),
 exposed_people integer NOT NULL DEFAULT 0 CHECK(exposed_people>=0),
 latitude double precision,
 longitude double precision,
 boundary_geojson jsonb,
 safe_points jsonb NOT NULL DEFAULT '[]'::jsonb,
 escape_routes jsonb NOT NULL DEFAULT '[]'::jsonb,
 notes text,
 last_reviewed_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);
CREATE INDEX IF NOT EXISTS territorial_risk_areas_org_level_idx ON territorial_risk_areas(organization_id,risk_level,status);

CREATE TABLE IF NOT EXISTS warning_assets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code varchar(80) NOT NULL,
 name varchar(240) NOT NULL,
 asset_type varchar(40) NOT NULL CHECK(asset_type IN('SIREN','LOUDSPEAKER','RADIO_BASE','CELL_BROADCAST','SMS','OTHER')),
 status varchar(30) NOT NULL DEFAULT 'OPERATIONAL' CHECK(status IN('OPERATIONAL','DEGRADED','MAINTENANCE','OFFLINE')),
 address_line varchar(300),
 neighborhood varchar(160),
 latitude double precision,
 longitude double precision,
 coverage_geojson jsonb,
 battery_percent numeric(5,2),
 responsible_name varchar(200),
 responsible_phone varchar(80),
 last_tested_at timestamptz,
 next_test_at timestamptz,
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS warning_activations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 risk_area_id uuid REFERENCES territorial_risk_areas(id) ON DELETE SET NULL,
 severity varchar(20) NOT NULL CHECK(severity IN('INFO','WATCH','WARNING','EMERGENCY')),
 title varchar(300) NOT NULL,
 message text NOT NULL,
 instruction text,
 cap_identifier varchar(200),
 channels jsonb NOT NULL DEFAULT '[]'::jsonb,
 target_area_geojson jsonb,
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','ENDED','CANCELLED')),
 published_at timestamptz,
 ended_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 approved_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warning_activations_org_status_idx ON warning_activations(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS evacuation_routes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 risk_area_id uuid REFERENCES territorial_risk_areas(id) ON DELETE SET NULL,
 code varchar(80) NOT NULL,
 name varchar(240) NOT NULL,
 origin_text varchar(300),
 destination_text varchar(300) NOT NULL,
 distance_meters integer,
 accessible boolean NOT NULL DEFAULT false,
 route_geojson jsonb,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','BLOCKED','REVIEW','INACTIVE')),
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS damage_assessments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
 assessment_type varchar(20) NOT NULL DEFAULT 'FIELD' CHECK(assessment_type IN('FIELD','FIDE','DMATE','FINAL')),
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','IN_PROGRESS','VALIDATED','CLOSED')),
 affected_people integer NOT NULL DEFAULT 0,
 displaced_people integer NOT NULL DEFAULT 0,
 homeless_people integer NOT NULL DEFAULT 0,
 injured_people integer NOT NULL DEFAULT 0,
 deaths integer NOT NULL DEFAULT 0,
 missing_people integer NOT NULL DEFAULT 0,
 houses_damaged integer NOT NULL DEFAULT 0,
 houses_destroyed integer NOT NULL DEFAULT 0,
 public_damage numeric(16,2) NOT NULL DEFAULT 0,
 private_damage numeric(16,2) NOT NULL DEFAULT 0,
 environmental_damage text,
 public_loss numeric(16,2) NOT NULL DEFAULT 0,
 private_loss numeric(16,2) NOT NULL DEFAULT 0,
 summary text,
 assessed_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES users(id),
 validated_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS damage_assessments_incident_idx ON damage_assessments(incident_id,created_at DESC);

CREATE TABLE IF NOT EXISTS damage_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 assessment_id uuid NOT NULL REFERENCES damage_assessments(id) ON DELETE CASCADE,
 category varchar(80) NOT NULL,
 description text NOT NULL,
 quantity numeric(14,2),
 unit varchar(40),
 estimated_value numeric(16,2),
 latitude double precision,
 longitude double precision,
 incident_attachment_id uuid REFERENCES incident_attachments(id) ON DELETE SET NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS critical_infrastructures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code varchar(80) NOT NULL,
 name varchar(240) NOT NULL,
 category varchar(60) NOT NULL CHECK(category IN('WATER','ENERGY','TELECOM','HEALTH','EDUCATION','ROAD','BRIDGE','DRAINAGE','FUEL','PUBLIC_SAFETY','SHELTER','OTHER')),
 owner_name varchar(240),
 responsible_name varchar(200),
 responsible_phone varchar(80),
 address_line varchar(300),
 neighborhood varchar(160),
 latitude double precision,
 longitude double precision,
 operational_status varchar(30) NOT NULL DEFAULT 'OPERATIONAL' CHECK(operational_status IN('OPERATIONAL','DEGRADED','INTERRUPTED','UNKNOWN')),
 criticality varchar(20) NOT NULL DEFAULT 'HIGH' CHECK(criticality IN('LOW','MEDIUM','HIGH','CRITICAL')),
 redundancy text,
 backup_power boolean NOT NULL DEFAULT false,
 autonomy_hours numeric(10,2),
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS critical_infrastructure_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 infrastructure_id uuid NOT NULL REFERENCES critical_infrastructures(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 status varchar(30) NOT NULL CHECK(status IN('OPERATIONAL','DEGRADED','INTERRUPTED','RESTORED')),
 impact text,
 estimated_restore_at timestamptz,
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS animal_rescues(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 shelter_id uuid REFERENCES shelters(id) ON DELETE SET NULL,
 species varchar(80) NOT NULL,
 quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 animal_name varchar(160),
 identification varchar(200),
 tutor_name varchar(200),
 tutor_phone varchar(80),
 found_location varchar(300),
 latitude double precision,
 longitude double precision,
 destination varchar(300),
 health_status varchar(40) NOT NULL DEFAULT 'UNKNOWN' CHECK(health_status IN('UNKNOWN','STABLE','INJURED','CRITICAL','DECEASED')),
 veterinary_notes text,
 microchip varchar(160),
 vaccination_status varchar(200),
 status varchar(30) NOT NULL DEFAULT 'RESCUED' CHECK(status IN('RESCUED','SHELTERED','VETERINARY','RETURNED','TRANSFERRED','DECEASED')),
 returned_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mitigation_projects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 risk_area_id uuid REFERENCES territorial_risk_areas(id) ON DELETE SET NULL,
 code varchar(80) NOT NULL,
 title varchar(300) NOT NULL,
 intervention_type varchar(100) NOT NULL,
 priority varchar(20) NOT NULL DEFAULT 'HIGH' CHECK(priority IN('LOW','MEDIUM','HIGH','CRITICAL')),
 status varchar(30) NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','DESIGN','PROCUREMENT','EXECUTION','SUSPENDED','COMPLETED','CANCELLED')),
 responsible_department varchar(200),
 funding_source varchar(240),
 estimated_cost numeric(16,2),
 contracted_cost numeric(16,2),
 starts_at date,
 expected_end_at date,
 completed_at date,
 residual_risk varchar(10),
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS community_nuclei(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code varchar(80) NOT NULL,
 name varchar(240) NOT NULL,
 neighborhood varchar(160),
 coordinator_name varchar(200),
 phone varchar(80),
 email varchar(254),
 members_count integer NOT NULL DEFAULT 0,
 risk_area_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 safe_points jsonb NOT NULL DEFAULT '[]'::jsonb,
 last_meeting_at timestamptz,
 last_training_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS disaster_cost_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 category varchar(80) NOT NULL,
 description text NOT NULL,
 supplier varchar(240),
 document_reference varchar(200),
 quantity numeric(14,2),
 unit varchar(40),
 amount numeric(16,2) NOT NULL DEFAULT 0,
 funding_source varchar(200),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disaster_cost_entries_incident_idx ON disaster_cost_entries(incident_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS incident_lessons(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 operation_id uuid REFERENCES emergency_operations(id) ON DELETE SET NULL,
 category varchar(80) NOT NULL,
 title varchar(300) NOT NULL,
 observation text NOT NULL,
 corrective_action text,
 responsible_name varchar(200),
 due_at timestamptz,
 status varchar(30) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','VERIFIED','CLOSED')),
 effectiveness_notes text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_readiness(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 resource_type varchar(30) NOT NULL CHECK(resource_type IN('VEHICLE','EQUIPMENT','RADIO','GENERATOR','BOAT','PUMP','OTHER')),
 resource_id uuid,
 code varchar(100) NOT NULL,
 name varchar(240) NOT NULL,
 readiness_status varchar(30) NOT NULL DEFAULT 'READY' CHECK(readiness_status IN('READY','RESTRICTED','MAINTENANCE','UNAVAILABLE')),
 next_maintenance_at timestamptz,
 calibration_due_at timestamptz,
 fuel_level_percent numeric(5,2),
 battery_percent numeric(5,2),
 location_text varchar(300),
 notes text,
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,resource_type,code)
);

CREATE TABLE IF NOT EXISTS sco_action_plan_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL REFERENCES emergency_operations(id) ON DELETE CASCADE,
 period_id uuid REFERENCES operational_periods(id) ON DELETE CASCADE,
 item_type varchar(30) NOT NULL CHECK(item_type IN('OBJECTIVE','ASSIGNMENT','SAFETY','MEDICAL','COMMUNICATION','LOGISTICS','DEMOBILIZATION')),
 title varchar(300) NOT NULL,
 detail text,
 assigned_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
 assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 due_at timestamptz,
 status varchar(30) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','DONE','CANCELLED')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_bulletins(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 warning_activation_id uuid REFERENCES warning_activations(id) ON DELETE SET NULL,
 title varchar(300) NOT NULL,
 content text NOT NULL,
 audience varchar(200),
 channels jsonb NOT NULL DEFAULT '[]'::jsonb,
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','PUBLISHED','EXPIRED','CANCELLED')),
 approved_by uuid REFERENCES users(id),
 published_at timestamptz,
 expires_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shelters
 ADD COLUMN IF NOT EXISTS responsible_name varchar(200),
 ADD COLUMN IF NOT EXISTS contact_phone varchar(80),
 ADD COLUMN IF NOT EXISTS accessible boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS kitchen_available boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS generator_available boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS pet_area_available boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS latitude double precision,
 ADD COLUMN IF NOT EXISTS longitude double precision,
 ADD COLUMN IF NOT EXISTS readiness_notes text,
 ADD COLUMN IF NOT EXISTS last_readiness_check_at timestamptz;

CREATE INDEX IF NOT EXISTS warning_assets_org_status_idx ON warning_assets(organization_id,status);
CREATE INDEX IF NOT EXISTS critical_infrastructures_org_status_idx ON critical_infrastructures(organization_id,operational_status,criticality);
CREATE INDEX IF NOT EXISTS animal_rescues_org_status_idx ON animal_rescues(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS mitigation_projects_org_status_idx ON mitigation_projects(organization_id,status,priority);
CREATE INDEX IF NOT EXISTS incident_lessons_org_status_idx ON incident_lessons(organization_id,status,due_at);
CREATE INDEX IF NOT EXISTS sco_action_plan_operation_idx ON sco_action_plan_items(operation_id,period_id,item_type,status);
