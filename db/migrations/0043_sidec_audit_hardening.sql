CREATE OR REPLACE FUNCTION prevent_sidec_continuity_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico de governança SIDEC é append-only e não pode ser alterado ou excluído';
END;
$$;

DROP TRIGGER IF EXISTS sidec_continuity_change_report_policy_events_immutable
  ON sidec_continuity_change_report_policy_events;
CREATE TRIGGER sidec_continuity_change_report_policy_events_immutable
BEFORE UPDATE OR DELETE ON sidec_continuity_change_report_policy_events
FOR EACH ROW EXECUTE FUNCTION prevent_sidec_continuity_history_mutation();

DROP TRIGGER IF EXISTS sidec_continuity_change_report_archive_verifications_immutable
  ON sidec_continuity_change_report_archive_verifications;
CREATE TRIGGER sidec_continuity_change_report_archive_verifications_immutable
BEFORE UPDATE OR DELETE ON sidec_continuity_change_report_archive_verifications
FOR EACH ROW EXECUTE FUNCTION prevent_sidec_continuity_history_mutation();

DROP TRIGGER IF EXISTS sidec_continuity_change_report_replica_verifications_immutable
  ON sidec_continuity_change_report_replica_verifications;
CREATE TRIGGER sidec_continuity_change_report_replica_verifications_immutable
BEFORE UPDATE OR DELETE ON sidec_continuity_change_report_replica_verifications
FOR EACH ROW EXECUTE FUNCTION prevent_sidec_continuity_history_mutation();

CREATE OR REPLACE FUNCTION guard_sidec_continuity_approval_delegation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Delegação de aprovação SIDEC não pode ser excluída; utilize revogação';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.delegator_user_id IS DISTINCT FROM NEW.delegator_user_id
    OR OLD.delegate_user_id IS DISTINCT FROM NEW.delegate_user_id
    OR OLD.valid_from IS DISTINCT FROM NEW.valid_from
    OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
    OR OLD.reason IS DISTINCT FROM NEW.reason
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Conteúdo originário da delegação SIDEC é imutável';
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by THEN
      RAISE EXCEPTION 'Revogação de delegação SIDEC é definitiva';
    END IF;
  ELSE
    IF (NEW.revoked_at IS NULL) <> (NEW.revoked_by IS NULL) THEN
      RAISE EXCEPTION 'Revogação SIDEC exige data e responsável simultaneamente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sidec_continuity_approval_delegations_guard
  ON sidec_continuity_approval_delegations;
CREATE TRIGGER sidec_continuity_approval_delegations_guard
BEFORE UPDATE OR DELETE ON sidec_continuity_approval_delegations
FOR EACH ROW EXECUTE FUNCTION guard_sidec_continuity_approval_delegation();

CREATE OR REPLACE FUNCTION validate_sidec_continuity_approval_delegation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valid_until<=now() THEN
    RAISE EXCEPTION 'Delegação SIDEC deve terminar no futuro';
  END IF;
  IF NEW.valid_until>NEW.valid_from+interval '90 days' THEN
    RAISE EXCEPTION 'Delegação SIDEC não pode exceder 90 dias';
  END IF;
  IF NEW.created_by<>NEW.delegator_user_id THEN
    RAISE EXCEPTION 'Delegação SIDEC somente pode ser criada pela autoridade delegante';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id=NEW.delegator_user_id AND u.organization_id=NEW.organization_id AND u.active=true
  ) THEN
    RAISE EXCEPTION 'Autoridade delegante inválida ou inativa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id=NEW.delegate_user_id AND u.organization_id=NEW.organization_id AND u.active=true
  ) THEN
    RAISE EXCEPTION 'Usuário delegado inválido ou inativo';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM sidec_continuity_approval_delegations d
    WHERE d.organization_id=NEW.organization_id
      AND d.delegate_user_id=NEW.delegate_user_id
      AND d.revoked_at IS NULL
      AND tstzrange(d.valid_from,d.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)')
  ) THEN
    RAISE EXCEPTION 'Usuário delegado já representa outra autoridade no mesmo período';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sidec_continuity_approval_delegations_validate
  ON sidec_continuity_approval_delegations;
CREATE TRIGGER sidec_continuity_approval_delegations_validate
BEFORE INSERT ON sidec_continuity_approval_delegations
FOR EACH ROW EXECUTE FUNCTION validate_sidec_continuity_approval_delegation();

COMMENT ON FUNCTION prevent_sidec_continuity_history_mutation() IS
  'Protege históricos de verificação e política WORM contra alteração ou exclusão.';
COMMENT ON FUNCTION guard_sidec_continuity_approval_delegation() IS
  'Mantém a delegação original imutável e permite apenas revogação definitiva.';
COMMENT ON FUNCTION validate_sidec_continuity_approval_delegation() IS
  'Valida vigência, identidade e ausência de autoridades simultâneas para o mesmo delegado.';
