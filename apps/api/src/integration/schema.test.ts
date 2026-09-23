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

test("conectores aceitam somente modos e estados previstos",async()=>{
 const r=await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='monitoring_connectors'::regclass AND contype='c'`);
 const defs=r.rows.map(x=>String(x.definition)).join(" ");
 assert.match(defs,/WEBHOOK/);
 assert.match(defs,/POLLING/);
 assert.match(defs,/ACTIVE/);
 assert.match(defs,/DISABLED/);
});
