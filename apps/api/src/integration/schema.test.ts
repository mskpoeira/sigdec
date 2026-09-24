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
 assert.ok(files.includes("0026_sidec_ed25519_integrity_proofs.sql"));
 assert.ok(files.includes("0027_sidec_public_integrity_timestamp_custody.sql"));
 assert.ok(files.includes("0028_sidec_worm_archive.sql"));
 assert.ok(files.includes("0029_sidec_worm_governance.sql"));
 assert.ok(files.includes("0030_sidec_worm_replication.sql"));
 assert.ok(files.includes("0031_sidec_resilience_operations.sql"));
 assert.ok(files.includes("0032_sidec_continuity_objectives.sql"));
});

test("política de continuidade SIDEC possui objetivos administrativos válidos",async()=>{
 const cols=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_resilience_policies'
    AND column_name IN ('rpo_minutes','rto_minutes','drill_max_age_hours','enabled')
  ORDER BY column_name`);
 assert.deepEqual(cols.rows.map(x=>x.column_name),["drill_max_age_hours","enabled","rpo_minutes","rto_minutes"]);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_resilience_policies'::regclass AND contype='c'`);
 const definitions=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(definitions,/rpo_minutes/);
 assert.match(definitions,/rto_minutes/);
 assert.match(definitions,/drill_max_age_hours/);
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

test("SIDEC v1.18 possui atestacao Ed25519 e historico de verificacoes",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_artifact_attestations','sidec_integrity_verifications') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_artifact_attestations","sidec_integrity_verifications"]);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_artifact_attestations'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/Ed25519/);
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_integrity_verifications'
    AND column_name IN ('hmac_valid','asymmetric_valid','overall_valid','verification_source') ORDER BY column_name`);
 assert.deepEqual(columns.rows.map(x=>x.column_name),["asymmetric_valid","hmac_valid","overall_valid","verification_source"]);
});

test("SIDEC v1.19 possui carimbo interno Ed25519 e suporte a cadeia de custodia",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='sidec_integrity_timestamps'`);
 assert.equal(tables.rowCount,1);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_integrity_timestamps'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/Ed25519/);
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_integrity_timestamps'
    AND column_name IN ('statement_hash','timestamped_at','signature','public_key','public_key_fingerprint') ORDER BY column_name`);
 assert.deepEqual(columns.rows.map(x=>x.column_name),["public_key","public_key_fingerprint","signature","statement_hash","timestamped_at"]);
});

test("SIDEC v1.20 possui recibo e verificacao de arquivo WORM",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_archive_receipts','sidec_archive_verifications') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_archive_receipts","sidec_archive_verifications"]);
 const receiptConstraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_archive_receipts'::regclass`);
 const defs=receiptConstraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/GOVERNANCE/);
 assert.match(defs,/COMPLIANCE/);
 const verificationConstraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_archive_verifications'::regclass`);
 const vdefs=verificationConstraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(vdefs,/SCHEDULED/);
 assert.match(vdefs,/MANUAL/);
 assert.match(vdefs,/ARCHIVE/);
});

test("SIDEC v1.21 possui historico monotônico de governanca WORM",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='sidec_archive_policy_events'`);
 assert.equal(tables.rowCount,1);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_archive_policy_events'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/RETENTION_EXTENDED/);
 assert.match(defs,/LEGAL_HOLD_ENABLED/);
 assert.doesNotMatch(defs,/RETENTION_SHORTENED/);
 assert.doesNotMatch(defs,/LEGAL_HOLD_DISABLED/);
});

test("SIDEC v1.22 possui replica WORM e verificacao independente",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_archive_replicas','sidec_archive_replica_verifications') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_archive_replica_verifications","sidec_archive_replicas"]);
 const constraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_archive_replica_verifications'::regclass`);
 const defs=constraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/SCHEDULED/);
 assert.match(defs,/MANUAL/);
 assert.match(defs,/REPLICATION/);
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_archive_replicas'
    AND column_name IN ('destination_code','version_id','content_hash','retain_until','legal_hold') ORDER BY column_name`);
 assert.deepEqual(columns.rows.map(x=>x.column_name),["content_hash","destination_code","legal_hold","retain_until","version_id"]);
});

test("SIDEC v1.23 possui retry drills e condicoes de resiliencia",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('sidec_replica_retry_jobs','sidec_restore_drills','sidec_resilience_conditions') ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),["sidec_replica_retry_jobs","sidec_resilience_conditions","sidec_restore_drills"]);
 const retryDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_replica_retry_jobs'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(retryDefs,/REPLICATE/);
 assert.match(retryDefs,/SYNC_POLICY/);
 const drillDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_restore_drills'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(drillDefs,/PRIMARY/);
 assert.match(drillDefs,/REPLICA/);
 assert.match(drillDefs,/SCHEDULED/);
 assert.match(drillDefs,/MANUAL/);
 const conditions=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_resilience_conditions'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(conditions,/CRITICAL/);
 assert.match(conditions,/MISSING_REPLICA/);
 const replicatedBy=await db.query(`SELECT is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_archive_replicas' AND column_name='replicated_by'`);
 assert.equal(replicatedBy.rows[0]?.is_nullable,"YES");
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
