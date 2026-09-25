ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_matricula varchar(32);

UPDATE audit_logs a
SET actor_matricula = u.matricula
FROM users u
WHERE a.actor_user_id = u.id
  AND a.actor_matricula IS NULL;

CREATE OR REPLACE FUNCTION sigdec_fill_audit_actor_matricula()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_matricula IS NULL AND NEW.actor_user_id IS NOT NULL THEN
    SELECT matricula INTO NEW.actor_matricula
    FROM users
    WHERE id = NEW.actor_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_actor_matricula ON audit_logs;
CREATE TRIGGER trg_audit_actor_matricula
BEFORE INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION sigdec_fill_audit_actor_matricula();

CREATE INDEX IF NOT EXISTS audit_logs_actor_matricula_idx
  ON audit_logs(actor_matricula, occurred_at DESC);

COMMENT ON COLUMN audit_logs.actor_matricula IS
  'Snapshot da matrícula funcional do servidor responsável pela atividade.';
