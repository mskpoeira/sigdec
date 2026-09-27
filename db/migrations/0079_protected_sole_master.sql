-- SIGDEC: matrícula 915789 é a única conta Master protegida.
-- Demais contas anteriormente vinculadas ao MASTER passam a Administrador.

INSERT INTO roles(code,name,level,system_role)
VALUES ('ADMINISTRADOR','Administrador',80,true)
ON CONFLICT(code) DO UPDATE SET name='Administrador',level=80,system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code='ADMINISTRADOR' AND p.code<>'system.master'
ON CONFLICT DO NOTHING;

-- Migra qualquer MASTER legado que não seja a matrícula protegida.
INSERT INTO user_roles(user_id,role_id)
SELECT ur.user_id,admin.id
FROM user_roles ur
JOIN roles master ON master.id=ur.role_id AND master.code='MASTER'
JOIN users u ON u.id=ur.user_id
CROSS JOIN roles admin
WHERE admin.code='ADMINISTRADOR' AND u.matricula<>'915789'
ON CONFLICT DO NOTHING;

DELETE FROM user_roles ur
USING roles r,users u
WHERE ur.role_id=r.id AND r.code='MASTER' AND ur.user_id=u.id AND u.matricula<>'915789';

-- Se a conta 915789 já existe, ela permanece ativa e vinculada ao MASTER.
UPDATE users SET active=true,updated_at=now() WHERE matricula='915789';
INSERT INTO user_roles(user_id,role_id)
SELECT u.id,r.id FROM users u CROSS JOIN roles r
WHERE u.matricula='915789' AND r.code='MASTER'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION sigdec_guard_protected_master_user()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.matricula='915789' THEN
    RAISE EXCEPTION 'PROTECTED_MASTER_CANNOT_BE_DELETED';
  END IF;
  IF TG_OP='UPDATE' AND OLD.matricula='915789' THEN
    IF NEW.matricula<>'915789' OR NEW.active=false THEN
      RAISE EXCEPTION 'PROTECTED_MASTER_CANNOT_BE_DEACTIVATED_OR_RENAMED';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sigdec_guard_protected_master_user ON users;
CREATE TRIGGER trg_sigdec_guard_protected_master_user
BEFORE UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION sigdec_guard_protected_master_user();

CREATE OR REPLACE FUNCTION sigdec_guard_master_role_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_user uuid;
  target_role uuid;
  target_matricula text;
  target_code text;
BEGIN
  target_user:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  target_role:=CASE WHEN TG_OP='DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  SELECT matricula INTO target_matricula FROM users WHERE id=target_user;
  SELECT code INTO target_code FROM roles WHERE id=target_role;

  IF target_code='MASTER' THEN
    IF TG_OP='DELETE' AND target_matricula='915789' THEN
      RAISE EXCEPTION 'PROTECTED_MASTER_ROLE_CANNOT_BE_REMOVED';
    END IF;
    IF TG_OP<>'DELETE' AND target_matricula<>'915789' THEN
      RAISE EXCEPTION 'MASTER_RESERVED_FOR_915789';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sigdec_guard_master_role_assignment ON user_roles;
CREATE TRIGGER trg_sigdec_guard_master_role_assignment
BEFORE INSERT OR UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION sigdec_guard_master_role_assignment();


-- Permissões funcionais criadas futuramente também chegam ao Administrador,
-- exceto a permissão interna e exclusiva do Master.
CREATE OR REPLACE FUNCTION sigdec_grant_new_permission_to_administrator()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code<>'system.master' THEN
    INSERT INTO role_permissions(role_id,permission_id)
    SELECT r.id,NEW.id FROM roles r WHERE r.code='ADMINISTRADOR'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sigdec_grant_new_permission_to_administrator ON permissions;
CREATE TRIGGER trg_sigdec_grant_new_permission_to_administrator
AFTER INSERT ON permissions
FOR EACH ROW EXECUTE FUNCTION sigdec_grant_new_permission_to_administrator();
