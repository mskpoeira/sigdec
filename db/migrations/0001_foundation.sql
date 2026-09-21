CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'municipality',
  document_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  matricula varchar(32) NOT NULL,
  display_name text NOT NULL,
  email text,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_matricula_normalized CHECK (matricula ~ '^[0-9A-Za-z_-]+$'),
  CONSTRAINT users_org_matricula_unique UNIQUE (organization_id, matricula)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(120) UNIQUE NOT NULL,
  description text NOT NULL
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  ip inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, occurred_at DESC);

INSERT INTO roles (code, name, level, system_role)
VALUES ('MASTER', 'Administrador Master', 100, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
('system.master','Acesso integral de administração do sistema'),
('users.manage','Gerenciar usuários, perfis e permissões'),
('audit.read','Consultar trilhas de auditoria'),
('incidents.manage','Gerenciar ocorrências'),
('dispatch.manage','Gerenciar despacho'),
('documents.manage','Gerenciar documentos técnicos'),
('disasters.manage','Gerenciar operações e desastres')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE audit_logs IS 'Trilha append-only; a aplicação não deve expor UPDATE/DELETE.';
