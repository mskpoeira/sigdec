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
 assert.ok(files.includes("0033_sidec_continuity_runbook.sql"));
 assert.ok(files.includes("0034_sidec_continuity_evidence_aar.sql"));
 assert.ok(files.includes("0035_sidec_continuity_schedule_escalation_lessons.sql"));
 assert.ok(files.includes("0036_sidec_continuity_action_effectiveness.sql"));
 assert.ok(files.includes("0037_sidec_continuity_improvement_loop.sql"));
 assert.ok(files.includes("0038_sidec_continuity_change_governance.sql"));
 assert.ok(files.includes("0039_sidec_continuity_change_effectiveness.sql"));
 assert.ok(files.includes("0040_sidec_continuity_step_identity_critical_seals.sql"));
 assert.ok(files.includes("0041_sidec_continuity_worm_approval_policy.sql"));
});

test("runbook SIDEC possui versionamento, etapas e exercícios controlados",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_plans','sidec_continuity_steps','sidec_continuity_exercises','sidec_continuity_exercise_steps'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_exercise_steps","sidec_continuity_exercises","sidec_continuity_plans","sidec_continuity_steps"
 ]);
 const planConstraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_plans'::regclass AND contype='c'`);
 const planDefs=planConstraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(planDefs,/DRAFT/);
 assert.match(planDefs,/ACTIVE/);
 assert.match(planDefs,/RETIRED/);
 const stepConstraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_steps'::regclass AND contype='c'`);
 const stepDefs=stepConstraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(stepDefs,/DECLARATION/);
 assert.match(stepDefs,/RECOVERY/);
 assert.match(stepDefs,/RETURN/);
 const exerciseConstraints=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_exercises'::regclass AND contype='c'`);
 const exerciseDefs=exerciseConstraints.rows.map(x=>String(x.definition)).join(" ");
 assert.match(exerciseDefs,/IN_PROGRESS/);
 assert.match(exerciseDefs,/COMPLETED/);
 assert.match(exerciseDefs,/PASS/);
 assert.match(exerciseDefs,/FAIL/);
});

test("SIDEC v1.27 possui evidencias AAR e acoes corretivas",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_step_evidence','sidec_continuity_aars','sidec_continuity_action_items'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_aars","sidec_continuity_action_items","sidec_continuity_step_evidence"
 ]);
 const evidenceDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_step_evidence'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(evidenceDefs,/NOTE/);
 assert.match(evidenceDefs,/LINK/);
 assert.match(evidenceDefs,/DOCUMENT/);
 assert.match(evidenceDefs,/HASH/);
 const aarDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_aars'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(aarDefs,/DRAFT/);
 assert.match(aarDefs,/FINAL/);
 const actionDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_action_items'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(actionDefs,/CRITICAL/);
 assert.match(actionDefs,/IN_PROGRESS/);
 assert.match(actionDefs,/DONE/);
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

test("SIDEC v1.28 possui agenda escalonamento alertas e licoes de continuidade",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_schedules','sidec_continuity_contacts','sidec_continuity_action_alerts','sidec_continuity_lessons'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_action_alerts","sidec_continuity_contacts","sidec_continuity_lessons","sidec_continuity_schedules"
 ]);
 const contactDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_contacts'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(contactDefs,/INTERNAL/);assert.match(contactDefs,/EXTERNAL/);assert.match(contactDefs,/RADIO/);
 const lessonDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_lessons'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(lessonDefs,/CONNECTIVITY/);assert.match(lessonDefs,/CRITICAL/);
 const alertDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_action_alerts'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(alertDefs,/DUE_SOON/);assert.match(alertDefs,/OVERDUE/);
});

test("SIDEC v1.29 possui vinculos e avaliacao de eficacia das acoes",async()=>{
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_action_items'
   AND column_name IN ('risk_id','recovery_action_id','effectiveness','effectiveness_notes','effectiveness_evaluated_at','effectiveness_evaluated_by')
  ORDER BY column_name`);
 assert.deepEqual(columns.rows.map(x=>x.column_name),[
  "effectiveness","effectiveness_evaluated_at","effectiveness_evaluated_by","effectiveness_notes","recovery_action_id","risk_id"
 ]);
 const defs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_action_items'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/NOT_EVALUATED/);
 assert.match(defs,/EFFECTIVE/);
 assert.match(defs,/PARTIAL/);
 assert.match(defs,/INEFFECTIVE/);
 assert.match(defs,/effectiveness.*NOT_EVALUATED.*OR.*status.*DONE/s);
});

test("SIDEC v1.30 possui ciclo de melhoria continua controlado",async()=>{
 const actionColumns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_action_items'
   AND column_name='recurrence_key'`);
 assert.equal(actionColumns.rowCount,1);
 const recoveryColumns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='recovery_actions'
   AND column_name='source_continuity_action_id'`);
 assert.equal(recoveryColumns.rowCount,1);
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='sidec_continuity_runbook_recommendations'`);
 assert.equal(tables.rowCount,1);
 const defs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_runbook_recommendations'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/OPEN/);
 assert.match(defs,/ACCEPTED/);
 assert.match(defs,/IMPLEMENTED/);
 assert.match(defs,/DISMISSED/);
 assert.match(defs,/CRITICAL/);
 const uniqueIndexes=await db.query(`SELECT indexdef FROM pg_indexes
  WHERE schemaname='public' AND tablename='recovery_actions' AND indexname='recovery_actions_source_continuity_action_uidx'`);
 assert.equal(uniqueIndexes.rowCount,1);
});

test("SIDEC v1.31 possui governanca de propostas mudanca e evidencias",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_change_proposals','sidec_continuity_change_evidence'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_change_evidence","sidec_continuity_change_proposals"
 ]);
 const proposalDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_proposals'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(proposalDefs,/PROPOSED/);
 assert.match(proposalDefs,/APPLIED/);
 assert.match(proposalDefs,/VERIFIED/);
 assert.match(proposalDefs,/CANCELLED/);
 const evidenceDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_evidence'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(evidenceDefs,/NOTE/);
 assert.match(evidenceDefs,/LINK/);
 assert.match(evidenceDefs,/DOCUMENT/);
 assert.match(evidenceDefs,/HASH/);
 const columns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_change_proposals'
   AND column_name IN ('status_notes','verification_exercise_id','target_plan_id') ORDER BY column_name`);
 assert.deepEqual(columns.rows.map(x=>x.column_name),["status_notes","target_plan_id","verification_exercise_id"]);
 const index=await db.query(`SELECT indexdef FROM pg_indexes
  WHERE schemaname='public' AND indexname='sidec_continuity_change_proposals_active_uidx'`);
 assert.equal(index.rowCount,1);
 assert.match(String(index.rows[0]?.indexdef??""),/CANCELLED/);
});

test("SIDEC v1.32 possui linhagem diff impactos e eficacia de mudancas",async()=>{
 const planColumns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_plans'
   AND column_name='parent_plan_id'`);
 assert.equal(planColumns.rowCount,1);
 const proposalColumns=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_change_proposals'
   AND column_name IN ('base_plan_id','baseline_exercise_id','diff_snapshot','effectiveness_outcome','effectiveness_snapshot')
  ORDER BY column_name`);
 assert.deepEqual(proposalColumns.rows.map(x=>x.column_name),[
  "base_plan_id","baseline_exercise_id","diff_snapshot","effectiveness_outcome","effectiveness_snapshot"
 ]);
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='sidec_continuity_change_impacts'`);
 assert.equal(tables.rowCount,1);
 const impactDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_impacts'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(impactDefs,/ADDED/);
 assert.match(impactDefs,/MODIFIED/);
 assert.match(impactDefs,/REMOVED/);
 const proposalDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_proposals'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(proposalDefs,/NO_BASELINE/);
 assert.match(proposalDefs,/IMPROVED/);
 assert.match(proposalDefs,/STABLE/);
 assert.match(proposalDefs,/REGRESSED/);
});

test("SIDEC v1.33 possui identidade persistente dupla aprovacao e selo imutavel",async()=>{
 const lineage=await db.query(`SELECT is_nullable,data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_steps' AND column_name='lineage_key'`);
 assert.equal(lineage.rowCount,1);
 assert.equal(lineage.rows[0]?.is_nullable,"NO");
 assert.equal(lineage.rows[0]?.data_type,"uuid");

 const lineageIndex=await db.query(`SELECT indexdef FROM pg_indexes
  WHERE schemaname='public' AND indexname='sidec_continuity_steps_plan_lineage_uidx'`);
 assert.equal(lineageIndex.rowCount,1);
 assert.match(String(lineageIndex.rows[0]?.indexdef??""),/UNIQUE/);
 assert.match(String(lineageIndex.rows[0]?.indexdef??""),/lineage_key/);

 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_change_approvals','sidec_continuity_change_report_seals'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_change_approvals","sidec_continuity_change_report_seals"
 ]);

 const approvalDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_approvals'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(approvalDefs,/APPROVED/);
 assert.match(approvalDefs,/REJECTED/);
 assert.match(approvalDefs,/proposal_id, decided_by/);

 const sealDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_seals'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(sealDefs,/Ed25519/);
 assert.match(sealDefs,/report_hash/);

 const immutable=await db.query(`SELECT tgname FROM pg_trigger
  WHERE tgrelid='sidec_continuity_change_report_seals'::regclass AND NOT tgisinternal
   AND tgname='sidec_continuity_change_report_seals_immutable'`);
 assert.equal(immutable.rowCount,1);

 const role=await db.query(`SELECT r.code,count(p.id)::int AS permissions
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id=r.id
  LEFT JOIN permissions p ON p.id=rp.permission_id
   AND p.code IN ('sidec_continuity.read','sidec_continuity_change.approve')
  WHERE r.code='SIDEC_CONTINUITY_APPROVER'
  GROUP BY r.code`);
 assert.equal(role.rowCount,1);
 assert.equal(Number(role.rows[0]?.permissions??0),2);
});

test("SIDEC v1.34 possui politica temporal e arquivo WORM dos relatorios",async()=>{
 const approvalCols=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_change_approvals'
   AND column_name IN ('valid_until','revalidated_at','revalidated_by')
  ORDER BY column_name`);
 assert.deepEqual(approvalCols.rows.map(x=>x.column_name),["revalidated_at","revalidated_by","valid_until"]);

 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_change_policies',
   'sidec_continuity_change_report_archives',
   'sidec_continuity_change_report_archive_verifications'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_change_policies",
  "sidec_continuity_change_report_archive_verifications",
  "sidec_continuity_change_report_archives"
 ]);

 const policyDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_policies'::regclass`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(policyDefs,/approval_valid_hours/);
 assert.match(policyDefs,/2160/);
 assert.match(policyDefs,/report_worm_retention_days/);

 const archiveTrigger=await db.query(`SELECT tgname FROM pg_trigger
  WHERE tgrelid='sidec_continuity_change_report_archives'::regclass AND NOT tgisinternal
   AND tgname='sidec_continuity_change_report_archives_immutable'`);
 assert.equal(archiveTrigger.rowCount,1);

 const verificationDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_archive_verifications'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(verificationDefs,/ARCHIVE/);
 assert.match(verificationDefs,/MANUAL/);
 assert.match(verificationDefs,/SCHEDULED/);

 const permission=await db.query(`SELECT code FROM permissions WHERE code='sidec_continuity_change.archive'`);
 assert.equal(permission.rowCount,1);
});

test("SIDEC v1.35 possui resiliencia WORM e delegacao temporaria",async()=>{
 const approvalCols=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sidec_continuity_change_approvals'
   AND column_name IN ('authority_user_id','delegation_id')
  ORDER BY column_name`);
 assert.deepEqual(approvalCols.rows.map(x=>x.column_name),["authority_user_id","delegation_id"]);

 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_approval_delegations',
   'sidec_continuity_change_report_policy_events',
   'sidec_continuity_change_report_replicas',
   'sidec_continuity_change_report_replica_verifications'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_approval_delegations",
  "sidec_continuity_change_report_policy_events",
  "sidec_continuity_change_report_replica_verifications",
  "sidec_continuity_change_report_replicas"
 ]);

 const delegationDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_approval_delegations'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(delegationDefs,/delegator_user_id/);
 assert.match(delegationDefs,/delegate_user_id/);
 assert.match(delegationDefs,/valid_until/);
 assert.match(delegationDefs,/valid_from/);

 const verificationDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_replica_verifications'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(verificationDefs,/REPLICATION/);
 assert.match(verificationDefs,/POLICY/);
 assert.match(verificationDefs,/SCHEDULED/);
 assert.match(verificationDefs,/MANUAL/);

 const permission=await db.query(`SELECT p.code,count(rp.role_id)::int AS roles
  FROM permissions p
  LEFT JOIN role_permissions rp ON rp.permission_id=p.id
  WHERE p.code='sidec_continuity_change.delegate'
  GROUP BY p.code`);
 assert.equal(permission.rowCount,1);
 assert.ok(Number(permission.rows[0]?.roles??0)>=2);
});

test("SIGDEC v1.35.1 endurece historico e delegacoes apos auditoria",async()=>{
 const triggers=await db.query(`SELECT tgname FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
   'sidec_continuity_change_report_policy_events_immutable',
   'sidec_continuity_change_report_archive_verifications_immutable',
   'sidec_continuity_change_report_replica_verifications_immutable',
   'sidec_continuity_approval_delegations_guard',
   'sidec_continuity_approval_delegations_validate'
  ) ORDER BY tgname`);
 assert.deepEqual(triggers.rows.map(x=>x.tgname),[
  "sidec_continuity_approval_delegations_guard",
  "sidec_continuity_approval_delegations_validate",
  "sidec_continuity_change_report_archive_verifications_immutable",
  "sidec_continuity_change_report_policy_events_immutable",
  "sidec_continuity_change_report_replica_verifications_immutable"
 ]);

 const functions=await db.query(`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc
  WHERE proname IN (
   'prevent_sidec_continuity_history_mutation',
   'guard_sidec_continuity_approval_delegation',
   'validate_sidec_continuity_approval_delegation'
  ) ORDER BY proname`);
 assert.equal(functions.rowCount,3);
 const defs=functions.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/append-only/);
 assert.match(defs,/90 days/);
 assert.match(defs,/tstzrange/);
 assert.match(defs,/created_by/);
});

test("SIGDEC v1.36 possui retry, drills PDF e condicoes de resiliencia dos relatorios",async()=>{
 const tables=await db.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
   'sidec_continuity_change_report_retry_jobs',
   'sidec_continuity_change_report_restore_drills',
   'sidec_continuity_change_report_resilience_conditions'
  ) ORDER BY table_name`);
 assert.deepEqual(tables.rows.map(x=>x.table_name),[
  "sidec_continuity_change_report_resilience_conditions",
  "sidec_continuity_change_report_restore_drills",
  "sidec_continuity_change_report_retry_jobs"
 ]);

 const retryDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_retry_jobs'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(retryDefs,/REPLICATE/);
 assert.match(retryDefs,/SYNC_POLICY/);

 const drillDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_restore_drills'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(drillDefs,/PRIMARY/);
 assert.match(drillDefs,/REPLICA/);
 assert.match(drillDefs,/SCHEDULED/);
 assert.match(drillDefs,/MANUAL/);

 const conditionDefs=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='sidec_continuity_change_report_resilience_conditions'::regclass AND contype='c'`)).rows.map(x=>String(x.definition)).join(" ");
 assert.match(conditionDefs,/RESTORE_FAILURE/);
 assert.match(conditionDefs,/MISSING_REPLICA/);
 assert.match(conditionDefs,/POLICY_DRIFT/);

 const trigger=await db.query(`SELECT tgname FROM pg_trigger
  WHERE NOT tgisinternal AND tgname='sidec_continuity_change_report_restore_drills_immutable'`);
 assert.equal(trigger.rowCount,1);
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
