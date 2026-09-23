CREATE TABLE humanitarian_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES humanitarian_items(id),
  movement_type varchar(20) NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK(quantity > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  CONSTRAINT humanitarian_stock_movement_type_check CHECK (movement_type IN ('IN','OUT','ADJUST_IN','ADJUST_OUT'))
);
CREATE INDEX humanitarian_stock_movements_org_item_idx ON humanitarian_stock_movements(organization_id,item_id,occurred_at DESC);

CREATE TABLE communication_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_type varchar(30) NOT NULL,
  code varchar(80) NOT NULL,
  description text NOT NULL,
  channel text,
  status varchar(30) NOT NULL DEFAULT 'AVAILABLE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code),
  CONSTRAINT communication_asset_type_check CHECK(asset_type IN ('BASE_RADIO','HANDHELD_RADIO','MOBILE_RADIO','REPEATER','OTHER')),
  CONSTRAINT communication_asset_status_check CHECK(status IN ('AVAILABLE','ASSIGNED','MAINTENANCE','INACTIVE'))
);

CREATE TABLE operational_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  channel text,
  sender text,
  recipient text,
  message text NOT NULL,
  priority varchar(20) NOT NULL DEFAULT 'ROUTINE',
  CONSTRAINT operational_communications_priority_check CHECK(priority IN ('ROUTINE','PRIORITY','EMERGENCY'))
);
CREATE INDEX operational_communications_org_time_idx ON operational_communications(organization_id,occurred_at DESC);

INSERT INTO permissions(code,description) VALUES
('communications.read','Consultar equipamentos e registros de comunicação'),
('communications.manage','Gerenciar equipamentos e registros de comunicação')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MASTER' AND p.code IN ('communications.read','communications.manage')
ON CONFLICT DO NOTHING;
