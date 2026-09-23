import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";

function org(id:string|null){ if(!id) throw Object.assign(new Error("Usuário sem organização vinculada."),{statusCode:409}); return id; }

const volunteerSchema=z.object({
 fullName:z.string().trim().min(3).max(200), phone:z.string().trim().max(50).optional(), email:z.string().email().optional(),
 availability:z.string().trim().max(300).optional(), shirtSize:z.string().trim().max(20).optional(),
 raincoatSize:z.string().trim().max(20).optional(), shoeSize:z.string().trim().max(20).optional(),
 skills:z.array(z.string().trim().min(1).max(80)).max(30).default([]), notes:z.string().trim().max(3000).optional()
});
const stationSchema=z.object({
 code:z.string().trim().min(1).max(80), name:z.string().trim().min(2).max(200),
 stationType:z.enum(["RAIN_GAUGE","RIVER_LEVEL","WEATHER","SLOPE","CAMERA","OTHER"]),
 provider:z.string().trim().max(120).optional(), externalId:z.string().trim().max(160).optional(),
 latitude:z.number().min(-90).max(90).optional(), longitude:z.number().min(-180).max(180).optional()
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});
const readingSchema=z.object({ measuredAt:z.coerce.date(), metric:z.string().trim().min(1).max(50), value:z.number(), unit:z.string().trim().min(1).max(30), source:z.string().trim().max(40).default("manual") });
const thresholdSchema=z.object({stationId:z.string().uuid(),metric:z.string().trim().min(1).max(50),severity:z.enum(["WATCH","WARNING","EMERGENCY"]),comparison:z.enum(["GTE","LTE"]),thresholdValue:z.number(),unit:z.string().trim().min(1).max(30),title:z.string().trim().min(3).max(240),guidance:z.string().trim().max(3000).optional(),protocolVersionId:z.string().uuid().optional()});
const monitoringEventStatusSchema=z.object({status:z.enum(["ACKNOWLEDGED","CLOSED"])});
const ingestKeySchema=z.object({name:z.string().trim().min(3).max(120)});
const externalReadingSchema=z.object({measuredAt:z.coerce.date(),metric:z.string().trim().min(1).max(50),value:z.number(),unit:z.string().trim().min(1).max(30)});
const rotateKeySchema=z.object({name:z.string().trim().min(3).max(120).optional()});
const protocolSchema=z.object({code:z.string().trim().min(2).max(60),title:z.string().trim().min(3).max(240),category:z.string().trim().min(2).max(80).default("MONITORING"),cobradeCode:z.string().trim().max(30).optional()});
const protocolTemplateSchema=z.object({code:z.string().trim().min(2).max(60),cobradeCode:z.string().trim().min(3).max(30),title:z.string().trim().min(3).max(240),category:z.string().trim().min(2).max(80).default("MONITORING"),severity:z.enum(["INFO","WATCH","WARNING","EMERGENCY"]).optional(),triggerSummary:z.string().trim().max(3000).optional(),guidance:z.string().trim().max(5000).optional(),steps:z.array(z.string().trim().min(2).max(500)).max(50).default([])});
const connectorSchema=z.object({stationId:z.string().uuid(),providerCode:z.string().trim().min(2).max(80),displayName:z.string().trim().min(3).max(200),mode:z.enum(["WEBHOOK","POLLING","MANUAL"]),externalReference:z.string().trim().max(300).optional()});
const connectorStatusSchema=z.object({status:z.enum(["CONFIGURED","ACTIVE","PAUSED","DISABLED"])});
const protocolVersionSchema=z.object({severity:z.enum(["INFO","WATCH","WARNING","EMERGENCY"]).optional(),triggerSummary:z.string().trim().max(3000).optional(),guidance:z.string().trim().max(5000).optional(),steps:z.array(z.string().trim().min(2).max(500)).max(50).default([]),changeSummary:z.string().trim().max(1000).optional()});


function tokenHash(token:string){return createHash("sha256").update(token).digest("hex");}
async function persistMonitoringReading(organizationId:string,stationId:string,v:z.infer<typeof readingSchema>){
 const reading=await db.query(`INSERT INTO monitoring_readings(station_id,measured_at,metric,value,unit,source) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT(station_id,measured_at,metric) DO UPDATE SET value=EXCLUDED.value,unit=EXCLUDED.unit,source=EXCLUDED.source
  RETURNING id`,[stationId,v.measuredAt,v.metric,v.value,v.unit,v.source]);
 const readingId=reading.rows[0]?.id;
 if(readingId){
  await db.query(`INSERT INTO monitoring_events(organization_id,station_id,reading_id,threshold_id,severity,metric,observed_value,threshold_value,unit,title,guidance,protocol_version_id)
   SELECT t.organization_id,t.station_id,$1,t.id,t.severity,t.metric,$2,t.threshold_value,t.unit,t.title,t.guidance,t.protocol_version_id
     FROM monitoring_thresholds t
    WHERE t.organization_id=$3 AND t.station_id=$4 AND t.metric=$5 AND t.unit=$6 AND t.active=true
      AND ((t.comparison='GTE' AND $2>=t.threshold_value) OR (t.comparison='LTE' AND $2<=t.threshold_value))
   ON CONFLICT(reading_id,threshold_id) DO NOTHING`,[readingId,v.value,organizationId,stationId,v.metric,v.unit]);
 }
 return readingId;
}

const shelterSchema=z.object({name:z.string().trim().min(2).max(200),addressLine:z.string().trim().max(300).optional(),neighborhood:z.string().trim().max(120).optional(),capacityPeople:z.number().int().min(0),status:z.enum(["STANDBY","OPEN","FULL","CLOSED"]).default("STANDBY"),notes:z.string().trim().max(3000).optional()});
const householdSchema=z.object({incidentId:z.string().uuid().optional(),shelterId:z.string().uuid().optional(),responsibleName:z.string().trim().min(3).max(200),phone:z.string().trim().max(50).optional(),addressOrigin:z.string().trim().max(300).optional(),neighborhoodOrigin:z.string().trim().max(120).optional(),adults:z.number().int().min(0).default(0),children:z.number().int().min(0).default(0),elderly:z.number().int().min(0).default(0),personsWithDisability:z.number().int().min(0).default(0),condition:z.enum(["DISPLACED","HOMELESS"]),notes:z.string().trim().max(3000).optional()});
const itemSchema=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(2).max(200),unit:z.string().trim().min(1).max(30),category:z.string().trim().min(1).max(50)});
const stockSchema=z.object({itemId:z.string().uuid(),movementType:z.enum(["IN","OUT","ADJUST_IN","ADJUST_OUT"]),quantity:z.number().positive(),reference:z.string().trim().max(200).optional(),notes:z.string().trim().max(2000).optional()});
const deliverySchema=z.object({incidentId:z.string().uuid().optional(),householdId:z.string().uuid().optional(),recipientName:z.string().trim().min(3).max(200),notes:z.string().trim().max(2000).optional()});

export async function responseRoutes(app:FastifyInstance){
 app.get("/api/v1/volunteers",{preHandler:requirePermission("volunteers.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT id,full_name AS "fullName",phone,email,status,availability,shirt_size AS "shirtSize",raincoat_size AS "raincoatSize",shoe_size AS "shoeSize",skills,notes FROM volunteers WHERE organization_id=$1 ORDER BY full_name`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/volunteers",{preHandler:requirePermission("volunteers.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=volunteerSchema.safeParse(req.body); if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO volunteers(organization_id,full_name,phone,email,availability,shirt_size,raincoat_size,shoe_size,skills,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[o,v.fullName,v.phone??null,v.email??null,v.availability??null,v.shirtSize??null,v.raincoatSize??null,v.shoeSize??null,v.skills,v.notes??null]);
  return reply.code(201).send({id:r.rows[0]?.id});
 });
 app.get("/api/v1/monitoring/stations",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT id,code,name,station_type AS "stationType",provider,external_id AS "externalId",latitude,longitude,active FROM monitoring_stations WHERE organization_id=$1 ORDER BY name`,[o]); return {items:r.rows};
 });
 app.post("/api/v1/monitoring/stations",{preHandler:requirePermission("monitoring.manage")},async(req,reply)=>{
  const o=org(authFrom(req).organizationId),p=stationSchema.safeParse(req.body); if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()}); const s=p.data;
  const r=await db.query(`INSERT INTO monitoring_stations(organization_id,code,name,station_type,provider,external_id,latitude,longitude,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8::double precision,$7::double precision),4326)::geography END) RETURNING id`,[o,s.code,s.name,s.stationType,s.provider??null,s.externalId??null,s.latitude??null,s.longitude??null]); return reply.code(201).send({id:r.rows[0]?.id});
 });
 app.post("/api/v1/monitoring/stations/:id/readings",{preHandler:requirePermission("monitoring.manage")},async(req,reply)=>{
  const o=org(authFrom(req).organizationId),{id}=req.params as {id:string},p=readingSchema.safeParse(req.body); if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const station=await db.query("SELECT 1 FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[id,o]); if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const readingId=await persistMonitoringReading(o,id,p.data);
  return reply.code(201).send({ok:true,readingId});
 });
 app.post("/api/v1/monitoring/stations/:id/ingest-keys",{preHandler:requirePermission("integrations.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=ingestKeySchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const station=await db.query("SELECT id FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[id,o]);if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const token="sigdec_"+randomBytes(32).toString("base64url");
  const r=await db.query(`INSERT INTO monitoring_ingest_keys(organization_id,station_id,name,token_hash,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,created_at AS "createdAt"`,[o,id,p.data.name,tokenHash(token),a.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.userId,"MONITORING_INGEST_KEY_CREATED","monitoring_station",id,req.ip,req.headers["user-agent"]??null,JSON.stringify({keyId:r.rows[0]?.id,name:p.data.name})]);
  return reply.code(201).send({...r.rows[0],token});
 });
 app.get("/api/v1/monitoring/stations/:id/ingest-keys",{preHandler:requirePermission("integrations.manage")},async(req,reply)=>{
  const o=org(authFrom(req).organizationId),{id}=req.params as {id:string};
  const station=await db.query("SELECT 1 FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[id,o]);if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT id,name,active,created_at AS "createdAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt",replaces_key_id AS "replacesKeyId" FROM monitoring_ingest_keys WHERE station_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[id,o]);
  return {items:r.rows};
 });
 app.post("/api/v1/monitoring/ingest-keys/:id/revoke",{preHandler:requirePermission("integrations.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string};
  const before=await db.query(`SELECT k.id,k.name,k.active,k.station_id AS "stationId" FROM monitoring_ingest_keys k WHERE k.id=$1 AND k.organization_id=$2`,[id,o]);
  const key=before.rows[0];if(!key)return reply.code(404).send({error:"NOT_FOUND"});if(!key.active)return reply.code(409).send({error:"ALREADY_REVOKED"});
  const r=await db.query(`UPDATE monitoring_ingest_keys SET active=false,revoked_at=now(),revoked_by=$1 WHERE id=$2 AND organization_id=$3 RETURNING id,active,revoked_at AS "revokedAt"`,[a.userId,id,o]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"MONITORING_INGEST_KEY_REVOKED","monitoring_ingest_key",id,req.ip,req.headers["user-agent"]??null,JSON.stringify(key),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });
 app.post("/api/v1/monitoring/ingest-keys/:id/rotate",{preHandler:requirePermission("integrations.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=rotateKeySchema.safeParse(req.body??{});if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const client=await db.connect();try{await client.query("BEGIN");const old=await client.query(`SELECT id,name,station_id AS "stationId",active FROM monitoring_ingest_keys WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,o]);const key=old.rows[0];if(!key){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}if(!key.active){await client.query("ROLLBACK");return reply.code(409).send({error:"ALREADY_REVOKED"});}
   const token="sigdec_"+randomBytes(32).toString("base64url"),name=p.data.name??key.name;
   await client.query(`UPDATE monitoring_ingest_keys SET active=false,revoked_at=now(),revoked_by=$1 WHERE id=$2`,[a.userId,id]);
   const created=await client.query(`INSERT INTO monitoring_ingest_keys(organization_id,station_id,name,token_hash,created_by,replaces_key_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,created_at AS "createdAt"`,[o,key.stationId,name,tokenHash(token),a.userId,id]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"MONITORING_INGEST_KEY_ROTATED","monitoring_ingest_key",created.rows[0]?.id,req.ip,req.headers["user-agent"]??null,JSON.stringify({replacedKeyId:id}),JSON.stringify({newKeyId:created.rows[0]?.id,stationId:key.stationId})]);
   await client.query("COMMIT");return reply.code(201).send({...created.rows[0],token,replacedKeyId:id});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
 });
 app.post("/api/v1/integrations/monitoring/readings",async(req,reply)=>{
  const header=req.headers.authorization??"";if(!header.startsWith("Bearer "))return reply.code(401).send({error:"UNAUTHENTICATED"});
  const token=header.slice(7).trim();if(!token)return reply.code(401).send({error:"UNAUTHENTICATED"});
  const p=externalReadingSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const key=await db.query(`SELECT k.id AS "keyId",k.organization_id AS "organizationId",k.station_id AS "stationId"
   FROM monitoring_ingest_keys k JOIN monitoring_stations s ON s.id=k.station_id
   WHERE k.token_hash=$1 AND k.active=true AND s.active=true`,[tokenHash(token)]);
  const k=key.rows[0] as {keyId:string;organizationId:string;stationId:string}|undefined;if(!k)return reply.code(401).send({error:"INVALID_INGEST_KEY"});
  const v={...p.data,source:"external"} as z.infer<typeof readingSchema>;
  const readingId=await persistMonitoringReading(k.organizationId,k.stationId,v);
  await db.query("UPDATE monitoring_ingest_keys SET last_used_at=now() WHERE id=$1",[k.keyId]);
  await db.query(`INSERT INTO audit_logs(action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`,["MONITORING_EXTERNAL_READING","monitoring_reading",String(readingId??""),req.ip,req.headers["user-agent"]??null,JSON.stringify({stationId:k.stationId,metric:v.metric,value:v.value,unit:v.unit}),JSON.stringify({ingestKeyId:k.keyId})]);
  return reply.code(201).send({ok:true,readingId});
 });
 app.post("/api/v1/monitoring/events/:id/alert-draft",{preHandler:requirePermission("alerts.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string};
  const ev=await db.query(`SELECT e.id,e.severity,e.title,e.guidance,e.metric,e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,s.code AS "stationCode",s.name AS "stationName",al.id AS "alertId"
   FROM monitoring_events e JOIN monitoring_stations s ON s.id=e.station_id LEFT JOIN alerts al ON al.monitoring_event_id=e.id
   WHERE e.id=$1 AND e.organization_id=$2`,[id,o]);
  const x=ev.rows[0];if(!x)return reply.code(404).send({error:"NOT_FOUND"});if(x.alertId)return reply.code(409).send({error:"ALERT_ALREADY_EXISTS",alertId:x.alertId});
  const message=`${x.stationCode} · ${x.stationName}. ${x.metric}: ${x.observedValue} ${x.unit}; limiar: ${x.thresholdValue} ${x.unit}.${x.guidance?" "+x.guidance:""}`;
  const r=await db.query(`INSERT INTO alerts(organization_id,severity,title,message,created_by,monitoring_event_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status`,[o,x.severity,x.title,message,a.userId,id]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"ALERT_DRAFT_FROM_MONITORING_EVENT","alert",r.rows[0]?.id,req.ip,req.headers["user-agent"]??null,JSON.stringify({status:"DRAFT",severity:x.severity,title:x.title}),JSON.stringify({monitoringEventId:id})]);
  return reply.code(201).send({id:r.rows[0]?.id,status:r.rows[0]?.status});
 });
 app.get("/api/v1/monitoring/connectors",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT c.id,c.station_id AS "stationId",s.code AS "stationCode",s.name AS "stationName",c.provider_code AS "providerCode",c.display_name AS "displayName",c.mode,c.status,c.external_reference AS "externalReference",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.last_success_at AS "lastSuccessAt",c.last_error_at AS "lastErrorAt",c.last_error AS "lastError"
    FROM monitoring_connectors c JOIN monitoring_stations s ON s.id=c.station_id
    WHERE c.organization_id=$1 ORDER BY c.updated_at DESC`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/monitoring/connectors",{preHandler:requirePermission("connectors.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=connectorSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const station=await db.query("SELECT 1 FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[v.stationId,o]);if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`INSERT INTO monitoring_connectors(organization_id,station_id,provider_code,display_name,mode,external_reference,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING id,provider_code AS "providerCode",display_name AS "displayName",mode,status`,[o,v.stationId,v.providerCode,v.displayName,v.mode,v.externalReference??null,a.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.userId,"MONITORING_CONNECTOR_CREATED","monitoring_connector",r.rows[0]?.id,req.ip,req.headers["user-agent"]??null,JSON.stringify(r.rows[0])]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/monitoring/connectors/:id/status",{preHandler:requirePermission("connectors.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=connectorStatusSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const before=await db.query(`SELECT id,status FROM monitoring_connectors WHERE id=$1 AND organization_id=$2`,[id,o]);if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`UPDATE monitoring_connectors SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING id,status,updated_at AS "updatedAt"`,[p.data.status,id,o]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"MONITORING_CONNECTOR_STATUS_CHANGED","monitoring_connector",id,req.ip,req.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });
 app.get("/api/v1/monitoring/protocol-templates",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT id,code,cobrade_code AS "cobradeCode",title,category,severity,trigger_summary AS "triggerSummary",guidance,steps,active,organization_id AS "organizationId"
    FROM operational_protocol_templates
    WHERE active=true AND (organization_id IS NULL OR organization_id=$1)
    ORDER BY cobrade_code,code`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/monitoring/protocol-templates",{preHandler:requirePermission("protocols.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=protocolTemplateSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const r=await db.query(`INSERT INTO operational_protocol_templates(organization_id,code,cobrade_code,title,category,severity,trigger_summary,guidance,steps,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    RETURNING id,code,cobrade_code AS "cobradeCode",title`,[o,v.code,v.cobradeCode,v.title,v.category,v.severity??null,v.triggerSummary??null,v.guidance??null,JSON.stringify(v.steps),a.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.userId,"OPERATIONAL_PROTOCOL_TEMPLATE_CREATED","operational_protocol_template",r.rows[0]?.id,req.ip,req.headers["user-agent"]??null,JSON.stringify(r.rows[0])]);
  return reply.code(201).send(r.rows[0]);
 });
 app.post("/api/v1/monitoring/protocol-templates/:id/instantiate",{preHandler:requirePermission("protocols.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string};
  const tpl=await db.query(`SELECT id,code,cobrade_code AS "cobradeCode",title,category,severity,trigger_summary AS "triggerSummary",guidance,steps
    FROM operational_protocol_templates WHERE id=$1 AND active=true AND (organization_id IS NULL OR organization_id=$2)`,[id,o]);
  const t=tpl.rows[0];if(!t)return reply.code(404).send({error:"NOT_FOUND"});
  const client=await db.connect();try{await client.query("BEGIN");
   const p=await client.query(`INSERT INTO operational_protocols(organization_id,code,title,category,cobrade_code,created_by)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id,code,title,cobrade_code AS "cobradeCode"`,[o,t.code,t.title,t.category,t.cobradeCode,a.userId]);
   const protocolId=p.rows[0]?.id;
   const v=await client.query(`INSERT INTO operational_protocol_versions(protocol_id,version_no,severity,trigger_summary,guidance,steps,change_summary,created_by)
     VALUES($1,1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id,version_no AS "versionNo",status`,[protocolId,t.severity??null,t.triggerSummary??null,t.guidance??null,JSON.stringify(t.steps??[]),"Criado a partir de modelo COBRADE "+t.cobradeCode,a.userId]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"OPERATIONAL_PROTOCOL_INSTANTIATED","operational_protocol",protocolId,req.ip,req.headers["user-agent"]??null,JSON.stringify(p.rows[0]),JSON.stringify({templateId:id,versionId:v.rows[0]?.id})]);
   await client.query("COMMIT");return reply.code(201).send({protocol:p.rows[0],version:v.rows[0]});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
 });
 app.get("/api/v1/monitoring/protocols",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT p.id,p.code,p.title,p.category,p.cobrade_code AS "cobradeCode",p.active,p.created_at AS "createdAt",v.id AS "activeVersionId",v.version_no AS "activeVersionNo",v.severity,v.trigger_summary AS "triggerSummary",v.guidance,v.steps
   FROM operational_protocols p LEFT JOIN operational_protocol_versions v ON v.protocol_id=p.id AND v.status='ACTIVE'
   WHERE p.organization_id=$1 ORDER BY p.code`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/monitoring/protocols",{preHandler:requirePermission("protocols.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=protocolSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const r=await db.query(`INSERT INTO operational_protocols(organization_id,code,title,category,cobrade_code,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,code,title,category,cobrade_code AS "cobradeCode"`,[o,v.code,v.title,v.category,v.cobradeCode??null,a.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.userId,"OPERATIONAL_PROTOCOL_CREATED","operational_protocol",r.rows[0]?.id,req.ip,req.headers["user-agent"]??null,JSON.stringify(r.rows[0])]);
  return reply.code(201).send(r.rows[0]);
 });
 app.get("/api/v1/monitoring/protocols/:id/versions",{preHandler:requirePermission("monitoring.read")},async(req,reply)=>{
  const o=org(authFrom(req).organizationId),{id}=req.params as {id:string};const p=await db.query("SELECT 1 FROM operational_protocols WHERE id=$1 AND organization_id=$2",[id,o]);if(!p.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT id,version_no AS "versionNo",severity,trigger_summary AS "triggerSummary",guidance,steps,status,change_summary AS "changeSummary",created_at AS "createdAt",activated_at AS "activatedAt" FROM operational_protocol_versions WHERE protocol_id=$1 ORDER BY version_no DESC`,[id]);return {items:r.rows};
 });
 app.post("/api/v1/monitoring/protocols/:id/versions",{preHandler:requirePermission("protocols.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=protocolVersionSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const protocol=await db.query("SELECT 1 FROM operational_protocols WHERE id=$1 AND organization_id=$2",[id,o]);if(!protocol.rows[0])return reply.code(404).send({error:"NOT_FOUND"});const v=p.data;
  const r=await db.query(`INSERT INTO operational_protocol_versions(protocol_id,version_no,severity,trigger_summary,guidance,steps,change_summary,created_by) SELECT $1,COALESCE(MAX(version_no),0)+1,$2,$3,$4,$5::jsonb,$6,$7 FROM operational_protocol_versions WHERE protocol_id=$1 RETURNING id,version_no AS "versionNo",status`,[id,v.severity??null,v.triggerSummary??null,v.guidance??null,JSON.stringify(v.steps),v.changeSummary??null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.post("/api/v1/monitoring/protocols/:id/versions/:versionId/activate",{preHandler:requirePermission("protocols.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id,versionId}=req.params as {id:string;versionId:string};const client=await db.connect();try{await client.query("BEGIN");const target=await client.query(`SELECT v.id,v.version_no AS "versionNo",v.status FROM operational_protocol_versions v JOIN operational_protocols p ON p.id=v.protocol_id WHERE v.id=$1 AND v.protocol_id=$2 AND p.organization_id=$3 FOR UPDATE`,[versionId,id,o]);if(!target.rows[0]){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}
   await client.query(`UPDATE operational_protocol_versions SET status='RETIRED' WHERE protocol_id=$1 AND status='ACTIVE' AND id<>$2`,[id,versionId]);
   const r=await client.query(`UPDATE operational_protocol_versions SET status='ACTIVE',activated_at=COALESCE(activated_at,now()) WHERE id=$1 RETURNING id,version_no AS "versionNo",status,activated_at AS "activatedAt"`,[versionId]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"OPERATIONAL_PROTOCOL_VERSION_ACTIVATED","operational_protocol_version",versionId,req.ip,req.headers["user-agent"]??null,JSON.stringify(target.rows[0]),JSON.stringify(r.rows[0])]);
   await client.query("COMMIT");return r.rows[0];
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
 });
 app.get("/api/v1/monitoring/readings/latest",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT DISTINCT ON (r.station_id,r.metric) r.id,r.station_id AS "stationId",s.name AS "stationName",s.code AS "stationCode",r.metric,r.value,r.unit,r.source,r.measured_at AS "measuredAt"
   FROM monitoring_readings r JOIN monitoring_stations s ON s.id=r.station_id
   WHERE s.organization_id=$1 ORDER BY r.station_id,r.metric,r.measured_at DESC`,[o]);
  return {items:r.rows};
 });
 app.get("/api/v1/monitoring/thresholds",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT t.id,t.station_id AS "stationId",s.name AS "stationName",t.metric,t.severity,t.comparison,t.threshold_value AS "thresholdValue",t.unit,t.title,t.guidance,t.active,t.protocol_version_id AS "protocolVersionId",p.code AS "protocolCode",pv.version_no AS "protocolVersionNo"
   FROM monitoring_thresholds t JOIN monitoring_stations s ON s.id=t.station_id LEFT JOIN operational_protocol_versions pv ON pv.id=t.protocol_version_id LEFT JOIN operational_protocols p ON p.id=pv.protocol_id WHERE t.organization_id=$1 ORDER BY s.name,t.metric,t.threshold_value`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/monitoring/thresholds",{preHandler:requirePermission("monitoring.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=thresholdSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const station=await db.query("SELECT 1 FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[v.stationId,o]);if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  if(v.protocolVersionId){const pv=await db.query(`SELECT 1 FROM operational_protocol_versions pv JOIN operational_protocols p ON p.id=pv.protocol_id WHERE pv.id=$1 AND p.organization_id=$2 AND pv.status='ACTIVE'`,[v.protocolVersionId,o]);if(!pv.rows[0])return reply.code(400).send({error:"INVALID_PROTOCOL_VERSION"});}
  const r=await db.query(`INSERT INTO monitoring_thresholds(organization_id,station_id,metric,severity,comparison,threshold_value,unit,title,guidance,created_by,protocol_version_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[o,v.stationId,v.metric,v.severity,v.comparison,v.thresholdValue,v.unit,v.title,v.guidance??null,a.userId,v.protocolVersionId??null]);
  return reply.code(201).send(r.rows[0]);
 });
 app.get("/api/v1/monitoring/events",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT e.id,e.station_id AS "stationId",s.name AS "stationName",s.code AS "stationCode",e.severity,e.metric,e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,e.title,e.guidance,e.status,e.created_at AS "createdAt",a.id AS "alertId",a.status AS "alertStatus",e.protocol_version_id AS "protocolVersionId",p.code AS "protocolCode",pv.version_no AS "protocolVersionNo",pv.steps AS "protocolSteps"
   FROM monitoring_events e JOIN monitoring_stations s ON s.id=e.station_id LEFT JOIN alerts a ON a.monitoring_event_id=e.id LEFT JOIN operational_protocol_versions pv ON pv.id=e.protocol_version_id LEFT JOIN operational_protocols p ON p.id=pv.protocol_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC LIMIT 200`,[o]);
  return {items:r.rows};
 });
 app.patch("/api/v1/monitoring/events/:id/status",{preHandler:requirePermission("monitoring.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=monitoringEventStatusSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const before=await db.query(`SELECT id,status FROM monitoring_events WHERE id=$1 AND organization_id=$2`,[id,o]);if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`UPDATE monitoring_events SET status=$1,acknowledged_by=CASE WHEN $1='ACKNOWLEDGED' THEN $2 ELSE acknowledged_by END,acknowledged_at=CASE WHEN $1='ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,closed_by=CASE WHEN $1='CLOSED' THEN $2 ELSE closed_by END,closed_at=CASE WHEN $1='CLOSED' THEN now() ELSE closed_at END WHERE id=$3 AND organization_id=$4 RETURNING id,status`,[p.data.status,a.userId,id,o]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.userId,"MONITORING_EVENT_STATUS_CHANGED","monitoring_event",id,req.ip,req.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });
 app.get("/api/v1/humanitarian/households",{preHandler:requirePermission("humanitarian.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT h.id,h.responsible_name AS "responsibleName",h.condition,h.adults,h.children,h.elderly,h.persons_with_disability AS "personsWithDisability",h.admitted_at AS "admittedAt",s.name AS "shelterName",i.protocol FROM assisted_households h LEFT JOIN shelters s ON s.id=h.shelter_id LEFT JOIN incidents i ON i.id=h.incident_id WHERE h.organization_id=$1 ORDER BY h.admitted_at DESC`,[o]); return {items:r.rows};
 });
 app.get("/api/v1/humanitarian/deliveries",{preHandler:requirePermission("humanitarian.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT d.id,d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",d.notes,i.protocol FROM humanitarian_deliveries d LEFT JOIN incidents i ON i.id=d.incident_id WHERE d.organization_id=$1 ORDER BY d.delivered_at DESC LIMIT 200`,[o]); return {items:r.rows};
 });
 app.get("/api/v1/humanitarian/shelters",{preHandler:requirePermission("humanitarian.read")},async req=>{const o=org(authFrom(req).organizationId),r=await db.query('SELECT id,name,address_line AS "addressLine",neighborhood,capacity_people AS "capacityPeople",status,notes FROM shelters WHERE organization_id=$1 ORDER BY name',[o]);return {items:r.rows};});
 app.post("/api/v1/humanitarian/shelters",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const o=org(authFrom(req).organizationId),p=shelterSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO shelters(organization_id,name,address_line,neighborhood,capacity_people,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[o,v.name,v.addressLine??null,v.neighborhood??null,v.capacityPeople,v.status,v.notes??null]);return reply.code(201).send(r.rows[0]);});
 app.post("/api/v1/humanitarian/households",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const o=org(authFrom(req).organizationId),p=householdSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO assisted_households(organization_id,incident_id,shelter_id,responsible_name,phone,address_origin,neighborhood_origin,adults,children,elderly,persons_with_disability,condition,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',[o,v.incidentId??null,v.shelterId??null,v.responsibleName,v.phone??null,v.addressOrigin??null,v.neighborhoodOrigin??null,v.adults,v.children,v.elderly,v.personsWithDisability,v.condition,v.notes??null]);return reply.code(201).send(r.rows[0]);});
 app.post("/api/v1/humanitarian/deliveries",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const a=authFrom(req),o=org(a.organizationId),p=deliverySchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO humanitarian_deliveries(organization_id,incident_id,household_id,recipient_name,notes,delivered_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[o,v.incidentId??null,v.householdId??null,v.recipientName,v.notes??null,a.userId]);return reply.code(201).send(r.rows[0]);});
 app.get("/api/v1/inventory/items",{preHandler:requirePermission("humanitarian.read")},async req=>{const o=org(authFrom(req).organizationId),r=await db.query(`SELECT i.id,i.code,i.name,i.unit,i.category,COALESCE(sum(CASE WHEN m.movement_type IN ('IN','ADJUST_IN') THEN m.quantity ELSE -m.quantity END),0) AS balance FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id=i.id WHERE i.organization_id=$1 GROUP BY i.id ORDER BY i.name`,[o]);return {items:r.rows};});
 app.post("/api/v1/inventory/items",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const o=org(authFrom(req).organizationId),p=itemSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO inventory_items(organization_id,code,name,unit,category) VALUES($1,$2,$3,$4,$5) RETURNING id',[o,v.code,v.name,v.unit,v.category]);return reply.code(201).send(r.rows[0]);});
 app.post("/api/v1/inventory/movements",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const a=authFrom(req),o=org(a.organizationId),p=stockSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;const i=await db.query('SELECT 1 FROM inventory_items WHERE id=$1 AND organization_id=$2',[v.itemId,o]);if(!i.rows[0])return reply.code(404).send({error:"NOT_FOUND"});const r=await db.query('INSERT INTO inventory_movements(organization_id,item_id,movement_type,quantity,reference,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[o,v.itemId,v.movementType,v.quantity,v.reference??null,v.notes??null,a.userId]);return reply.code(201).send(r.rows[0]);});
}
