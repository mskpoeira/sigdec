ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS integrity_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS integrity_hash char(64);

CREATE OR REPLACE FUNCTION sigdec_calculate_audit_hash(row_data audit_logs)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'id', row_data.id,
          'occurred_at_epoch', extract(epoch FROM row_data.occurred_at),
          'actor_user_id', row_data.actor_user_id,
          'actor_matricula', row_data.actor_matricula,
          'action', row_data.action,
          'entity_type', row_data.entity_type,
          'entity_id', row_data.entity_id,
          'ip', row_data.ip::text,
          'user_agent', row_data.user_agent,
          'before_data', row_data.before_data,
          'after_data', row_data.after_data,
          'metadata', row_data.metadata,
          'integrity_version', row_data.integrity_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

UPDATE audit_logs a
SET integrity_hash = sigdec_calculate_audit_hash(a)
WHERE integrity_hash IS NULL;

ALTER TABLE audit_logs
  ALTER COLUMN integrity_hash SET NOT NULL;

CREATE OR REPLACE FUNCTION sigdec_seal_audit_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.integrity_version := COALESCE(NEW.integrity_version,1);
  NEW.integrity_hash := sigdec_calculate_audit_hash(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_audit_integrity_seal ON audit_logs;
CREATE TRIGGER zz_audit_integrity_seal
BEFORE INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION sigdec_seal_audit_log();

CREATE OR REPLACE FUNCTION sigdec_prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria do SIGDEC é append-only e não pode ser alterada ou excluída';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION sigdec_prevent_audit_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION sigdec_prevent_audit_mutation();

CREATE INDEX IF NOT EXISTS audit_logs_integrity_hash_idx
  ON audit_logs(integrity_hash);

COMMENT ON COLUMN audit_logs.integrity_hash IS
  'SHA-256 do conteúdo canônico do registro de auditoria, usado para verificação de integridade.';
COMMENT ON FUNCTION sigdec_calculate_audit_hash(audit_logs) IS
  'Recalcula o SHA-256 de um registro de auditoria sem utilizar o próprio campo integrity_hash.';
COMMENT ON FUNCTION sigdec_prevent_audit_mutation() IS
  'Impede UPDATE e DELETE na trilha geral de auditoria do SIGDEC.';
