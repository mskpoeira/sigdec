import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../db.js";

after(async()=>{await db.end();});

test("todas as migrations recentes foram aplicadas",async()=>{
 const r=await db.query("SELECT filename FROM schema_migrations ORDER BY filename");
 const files=r.rows.map(x=>String(x.filename));
 assert.ok(files.includes("0017_cobrade_sitrep_documents.sql"));
 assert.ok(files.includes("0018_monitoring_connectors.sql"));
 assert.ok(files.includes("0019_cobrade_catalog.sql"));
 assert.ok(files.includes("0020_sidec_reference_operations.sql"));
 assert.ok(files.includes("0021_sidec_interoperability.sql"));
 assert.ok(files.includes("0022_sidec_readiness_mapping_documents.sql"));
 assert.ok(files.includes("0023_sidec_manifest_cobrade_returns.sql"));
 assert.ok(files.includes("0024_sidec_sealed_artifacts_document_requirements.sql"));
 assert.ok(files.includes("0025_sidec_key_versions_deadlines_retention.sql"));
});

test("schema documental preserva fonte e snapshot",async()=>{
 const r=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='technical_documents'
    AND column_name IN ('source_type','source_snapshot') ORDER BY column_name`);
 assert.deepEqual(r.rows.map(x=>x.column_name),["source_snapshot","source_type"]);
});

test("catalogo COBRADE impede codigo duplicado na mesma organizacao",async()=>{
 const client=await db.connect();
 try{
  await client.query("BEGIN");
  const org=await client.query("INSERT INTO organizations(name) VALUES('Teste integração') RETURNING id");
  const user=await client.query("INSERT INTO users(organization_id,matricula,display_name,password_hash) VALUES($1,'ci-user','CI User','x') RETURNING id",[org.rows[0].id]);
  await client.query("INSERT INTO cobrade_catalog(organization_id,code,name,imported_by) VALUES($1,'TEST-1','Evento A',$2)",[org.rows[0].id,user.rows[0].id]);
  await assert.rejects(
   client.query("INSERT INTO cobrade_catalog(organization_id,code,name,imported_by) VALUES($1,'TEST-1','Evento B',$2)",[org.rows[0].id,user.rows[0].id]),
   (error:any)=>error?.code==="23505"
  );
 }finally{
  await client.query("ROLLBACK");
  client.release();
 }
});

test("estruturas inspiradas no SIDEC possuem constraints de fluxo",async()=>{
 const actions=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='civil_defense_actions'::regclass AND contype='c'`);
 const requests=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='operational_support_requests'::regclass AND contype='c'`);
 const actionDefs=actions.rows.map(x=>String(x.definition)).join(" ");
 const requestDefs=requests.rows.map(x=>String(x.definition)).join(" ");
 assert.match(actionDefs,/PREVENTION/);
 assert.match(actionDefs,/HUMANITARIAN/);
 assert.match(requestDefs,/HUMANITARIAN_AID/);
 assert.match(requestDefs,/EMERGENCY_INSPECTION/);
 assert.match(requestDefs,/SUBMITTED/);
 assert.match(requestDefs,/COMPLETED/);
});

test("pacotes SIDEC possuem revisao unica e estados controlados",async()=>{
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_exports'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/READY/);
 assert.match(defs,/SUBMITTED/);
 assert.match(defs,/ACKNOWLEDGED/);
 assert.match(defs,/incident_id, revision/);
});

test("SIDEC v1.14 possui mapeamentos, checklist e manifesto documental",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_field_mappings','sidec_export_documents') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_export_documents","sidec_field_mappings"]);
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_exports' AND column_name='readiness_snapshot'`);
 assert.equal(columns.rowCount,1);
 const defaults=await db.query(`SELECT count(*)::int AS count FROM sidec_field_mappings WHERE organization_id IS NULL AND enabled=true`);
 assert.ok(Number(defaults.rows[0]?.count??0)>=5);
});

test("SIDEC v1.15 possui manifesto requisitos COBRADE e retorno idempotente",async()=>{
 const column=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_exports' AND column_name='manifest_hash'`);
 assert.equal(column.rowCount,1);
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_cobrade_requirements','sidec_return_records') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_cobrade_requirements","sidec_return_records"]);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_return_records'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/ACKNOWLEDGED/);
 assert.match(defs,/REJECTED/);
 assert.match(defs,/export_id, payload_hash/);
});

test("SIDEC v1.16 possui artefato selado imutavel e requisitos documentais",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_export_artifacts','sidec_document_requirements') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_document_requirements","sidec_export_artifacts"]);
 const trigger=await db.query(`SELECT tgname FROM pg_trigger
  WHERE tgrelid='sidec_export_artifacts'::regclass AND NOT tgisinternal AND tgname='sidec_export_artifacts_immutable'`);
 assert.equal(trigger.rowCount,1);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_document_requirements'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/DEFAULT/);
 assert.match(defs,/COBRADE/);
 assert.match(defs,/INCIDENT_TYPE/);
 assert.match(defs,/REPORT/);
});

test("SIDEC v1.17 possui keyId SLAs e retencao separada",async()=>{
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_export_artifacts' AND column_name='signing_key_id'`);
 assert.equal(columns.rowCount,1);
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_artifact_retention','sidec_deadline_policies','sidec_deadline_alerts') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_artifact_retention","sidec_deadline_alerts","sidec_deadline_policies"]);
 const policies=await db.query(`SELECT pending_status AS "pendingStatus",warning_after_hours AS "warningAfterHours"
  FROM sidec_deadline_policies WHERE organization_id IS NULL ORDER BY pending_status`);
 assert.equal(policies.rowCount,4);
 const defs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_artifact_retention'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/LEGAL_HOLD/);
 assert.match(defs,/ARCHIVAL/);
});

test("conectores aceitam somente modos e estados previstos",async()=>{
 const r=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='monitoring_connectors'::regclass AND contype='c'`);
 const defs=r.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/WEBHOOK/);
 assert.match(defs,/POLLING/);
 assert.match(defs,/ACTIVE/);
 assert.match(defs,/DISABLED/);
});
