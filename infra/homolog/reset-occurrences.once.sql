BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_runs (
  maintenance_key text PRIMARY KEY,
  executed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
DECLARE
  target_org uuid;
  fk record;
  deleted_incidents integer := 0;
  deleted_dispatches integer := 0;
  deleted_counters integer := 0;
  released_teams integer := 0;
  released_vehicles integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM maintenance_runs
    WHERE maintenance_key='homolog_reset_incidents_dispatches_20260927_02'
  ) THEN
    RAISE NOTICE 'Limpeza de ocorrencias/despachos ja executada; nada a fazer.';
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

  SELECT count(*)::int INTO deleted_dispatches
  FROM dispatches d
  JOIN incidents i ON i.id=d.incident_id
  WHERE i.organization_id=target_org;

  FOR fk IN
    SELECT ns.nspname AS schema_name,
           cls.relname AS table_name,
           att.attname AS column_name,
           att.attnotnull,
           con.confdeltype
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid=con.conrelid
    JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum,ord) ON true
    JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum
    WHERE con.contype='f'
      AND con.confrelid='public.incidents'::regclass
      AND array_length(con.conkey,1)=1
  LOOP
    IF fk.confdeltype IN ('c','n','d') THEN
      CONTINUE;
    END IF;

    IF fk.attnotnull THEN
      EXECUTE format(
        'DELETE FROM %I.%I WHERE %I IN (SELECT id FROM public.incidents WHERE organization_id=$1)',
        fk.schema_name,fk.table_name,fk.column_name
      ) USING target_org;
    ELSE
      EXECUTE format(
        'UPDATE %I.%I SET %I=NULL WHERE %I IN (SELECT id FROM public.incidents WHERE organization_id=$1)',
        fk.schema_name,fk.table_name,fk.column_name,fk.column_name
      ) USING target_org;
    END IF;
  END LOOP;

  DELETE FROM incidents WHERE organization_id=target_org;
  GET DIAGNOSTICS deleted_incidents = ROW_COUNT;

  DELETE FROM incident_counters WHERE organization_id=target_org;
  GET DIAGNOSTICS deleted_counters = ROW_COUNT;

  UPDATE teams
     SET status='AVAILABLE', updated_at=now()
   WHERE organization_id=target_org
     AND status IN ('DISPATCHED','EN_ROUTE','ON_SCENE','RETURNING');
  GET DIAGNOSTICS released_teams = ROW_COUNT;

  UPDATE vehicles
     SET status='AVAILABLE', updated_at=now()
   WHERE organization_id=target_org
     AND status IN ('DISPATCHED','EN_ROUTE','ON_SCENE','RETURNING');
  GET DIAGNOSTICS released_vehicles = ROW_COUNT;

  INSERT INTO maintenance_runs(maintenance_key,details)
  VALUES(
    'homolog_reset_incidents_dispatches_20260927_02',
    jsonb_build_object(
      'organizationId',target_org,
      'deletedIncidents',deleted_incidents,
      'deletedDispatches',deleted_dispatches,
      'deletedCounters',deleted_counters,
      'releasedTeams',released_teams,
      'releasedVehicles',released_vehicles,
      'nextIncidentSequence',1,
      'requestedAction','clear incidents and dispatches; reset incident numbering'
    )
  );

  RAISE NOTICE 'Limpeza concluida: % ocorrencias, % despachos, % contadores.',
    deleted_incidents,deleted_dispatches,deleted_counters;
END
$$;

COMMIT;

SELECT
  count(DISTINCT i.id) AS incidents_remaining
FROM incidents i
JOIN users u ON u.organization_id=i.organization_id
WHERE regexp_replace(u.matricula,'[^0-9]','','g')='915789';

SELECT
  count(*) AS dispatches_remaining
FROM dispatches d
JOIN incidents i ON i.id=d.incident_id
JOIN users u ON u.organization_id=i.organization_id
WHERE regexp_replace(u.matricula,'[^0-9]','','g')='915789';

SELECT
  count(DISTINCT c.organization_id::text||':'||c.year::text) AS counters_remaining
FROM incident_counters c
JOIN users u ON u.organization_id=c.organization_id
WHERE regexp_replace(u.matricula,'[^0-9]','','g')='915789';

SELECT details AS cleanup_details
FROM maintenance_runs
WHERE maintenance_key='homolog_reset_incidents_dispatches_20260927_02';
