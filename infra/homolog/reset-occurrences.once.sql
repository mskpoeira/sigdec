BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_runs (
  maintenance_key text PRIMARY KEY,
  executed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
DECLARE
  target_org uuid;
  deleted_incidents integer := 0;
  deleted_counters integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM maintenance_runs
    WHERE maintenance_key='homolog_reset_incidents_20260927_01'
  ) THEN
    RAISE NOTICE 'Limpeza de ocorrencias ja executada; nada a fazer.';
    RETURN;
  END IF;

  SELECT organization_id INTO target_org
  FROM users
  WHERE regexp_replace(matricula,'[^0-9]','','g')='915789'
  ORDER BY created_at ASC
  LIMIT 1;

  IF target_org IS NULL THEN
    RAISE EXCEPTION 'Organizacao do Master 915789 nao localizada.';
  END IF;

  DELETE FROM incidents WHERE organization_id=target_org;
  GET DIAGNOSTICS deleted_incidents = ROW_COUNT;

  DELETE FROM incident_counters WHERE organization_id=target_org;
  GET DIAGNOSTICS deleted_counters = ROW_COUNT;

  INSERT INTO maintenance_runs(maintenance_key,details)
  VALUES(
    'homolog_reset_incidents_20260927_01',
    jsonb_build_object(
      'organizationId',target_org,
      'deletedIncidents',deleted_incidents,
      'deletedCounters',deleted_counters,
      'requestedAction','clear incidents and dispatches; reset incident numbering'
    )
  );
END
$$;

COMMIT;

SELECT
  (SELECT count(DISTINCT i.id) FROM incidents i
    JOIN users u ON u.organization_id=i.organization_id
    WHERE regexp_replace(u.matricula,'[^0-9]','','g')='915789') AS incidents_remaining,
  (SELECT count(DISTINCT c.organization_id::text||':'||c.year::text) FROM incident_counters c
    JOIN users u ON u.organization_id=c.organization_id
    WHERE regexp_replace(u.matricula,'[^0-9]','','g')='915789') AS counters_remaining,
  (SELECT details FROM maintenance_runs
    WHERE maintenance_key='homolog_reset_incidents_20260927_01') AS cleanup_details;
