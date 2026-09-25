import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { parseCobradeCatalogCsv } from "../lib/cobrade-catalog.js";
import { normalizeMonitoringPayload } from "../lib/monitoring-adapters.js";

function org(id:string|null){ if(!id) throw Object.assign(new Error("Usuário sem organização vinculada."),{statusCode:409}); return id; }

const certificationSchema=z.object({
 name:z.string().trim().min(2).max(200),institution:z.string().trim().max(200).optional(),
 workloadHours:z.number().nonnegative().max(100000).optional(),validUntil:z.string().trim().max(40).optional(),
 certificateRef:z.string().trim().max(500).optional()
});
const volunteerSchema=z.object({
 fullName:z.string().trim().min(3).max(200), phone:z.string().trim().max(50).optional(), email:z.string().email().optional(),
 availability:z.string().trim().max(300).optional(), shirtSize:z.string().trim().max(20).optional(),
 pantsSize:z.string().trim().max(20).optional(),jacketSize:z.string().trim().max(20).optional(),
 raincoatSize:z.string().trim().max(20).optional(),vestSize:z.string().trim().max(20).optional(),
 gloveSize:z.string().trim().max(20).optional(),shoeSize:z.string().trim().max(20).optional(),
 profession:z.string().trim().max(200).optional(),education:z.string().trim().max(300).optional(),
 institution:z.string().trim().max(200).optional(),cnhCategory:z.string().trim().max(30).optional(),
 languages:z.array(z.string().trim().min(1).max(60)).max(20).default([]),
 radioamateurCallSign:z.string().trim().max(40).optional(),operationRegion:z.string().trim().max(200).optional(),
 skills:z.array(z.string().trim().min(1).max(80)).max(30).default([]),
 validatedSkills:z.array(z.string().trim().min(1).max(80)).max(30).default([]),
 certifications:z.array(certificationSchema).max(100).default([]),
 history:z.array(z.record(z.string(),z.unknown())).max(200).default([]),
 notes:z.string().trim().max(3000).optional()
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
const rotateKeySchema=z.object({name:z.string().trim().min(3).max(120).optional()});
const protocolSchema=z.object({code:z.string().trim().min(2).max(60),title:z.string().trim().min(3).max(240),category:z.string().trim().min(2).max(80).default("MONITORING"),cobradeCode:z.string().trim().max(30).optional()});
const protocolTemplateSchema=z.object({code:z.string().trim().min(2).max(60),cobradeCode:z.string().trim().min(3).max(30),title:z.string().trim().min(3).max(240),category:z.string().trim().min(2).max(80).default("MONITORING"),severity:z.enum(["INFO","WATCH","WARNING","EMERGENCY"]).optional(),triggerSummary:z.string().trim().max(3000).optional(),guidance:z.string().trim().max(5000).optional(),steps:z.array(z.string().trim().min(2).max(500)).max(50).default([])});
const connectorSchema=z.object({stationId:z.string().uuid(),providerCode:z.string().trim().min(2).max(80),displayName:z.string().trim().min(3).max(200),mode:z.enum(["WEBHOOK","POLLING","MANUAL"]),externalReference:z.string().trim().max(300).optional()});
const connectorStatusSchema=z.object({status:z.enum(["CONFIGURED","ACTIVE","PAUSED","DISABLED"])});
const cobradeImportSchema=z.object({csv:z.string().min(10).max(2_000_000),sourceName:z.string().trim().max(200).optional(),sourceVersion:z.string().trim().max(120).optional()});
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
const deliverySchema=z.object({
 incidentId:z.string().uuid().optional(),householdId:z.string().uuid().optional(),
 recipientName:z.string().trim().min(3).max(200),notes:z.string().trim().max(2000).optional(),
 items:z.array(z.object({itemId:z.string().uuid(),quantity:z.number().positive().max(100000)})).min(1).max(50),
 duplicateAcknowledged:z.boolean().default(false),duplicateReason:z.string().trim().max(2000).optional()
}).superRefine((v,ctx)=>{
 if(v.duplicateAcknowledged&&(!v.duplicateReason||v.duplicateReason.length<5)){
  ctx.addIssue({code:z.ZodIssueCode.custom,path:["duplicateReason"],message:"Justifique a entrega após alerta de possível duplicidade."});
 }
});

export async function responseRoutes(app:FastifyInstance){
 app.get("/api/v1/volunteers",{preHandler:requirePermission("volunteers.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT id,full_name AS "fullName",phone,email,status,availability,
   shirt_size AS "shirtSize",pants_size AS "pantsSize",jacket_size AS "jacketSize",
   raincoat_size AS "raincoatSize",vest_size AS "vestSize",glove_size AS "gloveSize",shoe_size AS "shoeSize",
   profession,education,institution,cnh_category AS "cnhCategory",languages,
   radioamateur_call_sign AS "radioamateurCallSign",operation_region AS "operationRegion",
   skills,validated_skills AS "validatedSkills",certifications,history,notes
   FROM volunteers WHERE organization_id=$1 ORDER BY full_name`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/volunteers",{preHandler:requirePermission("volunteers.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=volunteerSchema.safeParse(req.body); if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO volunteers(
   organization_id,full_name,phone,email,availability,shirt_size,pants_size,jacket_size,raincoat_size,vest_size,glove_size,shoe_size,
   profession,education,institution,cnh_category,languages,radioamateur_call_sign,operation_region,skills,validated_skills,certifications,history,notes
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24) RETURNING id`,[
   o,v.fullName,v.phone??null,v.email??null,v.availability??null,v.shirtSize??null,v.pantsSize??null,v.jacketSize??null,
   v.raincoatSize??null,v.vestSize??null,v.gloveSize??null,v.shoeSize??null,v.profession??null,v.education??null,v.institution??null,
   v.cnhCategory??null,v.languages,v.radioamateurCallSign??null,v.operationRegion??null,v.skills,v.validatedSkills,
   JSON.stringify(v.certifications),JSON.stringify(v.history),v.notes??null
  ]);
  return reply.code(201).send({id:r.rows[0]?.id});
 });
 app.put("/api/v1/volunteers/:id",{preHandler:requirePermission("volunteers.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),{id}=req.params as {id:string},p=volunteerSchema.safeParse(req.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;const before=await db.query("SELECT * FROM volunteers WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`UPDATE volunteers SET full_name=$1,phone=$2,email=$3,availability=$4,shirt_size=$5,pants_size=$6,jacket_size=$7,
   raincoat_size=$8,vest_size=$9,glove_size=$10,shoe_size=$11,profession=$12,education=$13,institution=$14,cnh_category=$15,
   languages=$16,radioamateur_call_sign=$17,operation_region=$18,skills=$19,validated_skills=$20,certifications=$21::jsonb,
   history=$22::jsonb,notes=$23,updated_at=now()
   WHERE id=$24 AND organization_id=$25 RETURNING id`,[
   v.fullName,v.phone??null,v.email??null,v.availability??null,v.shirtSize??null,v.pantsSize??null,v.jacketSize??null,
   v.raincoatSize??null,v.vestSize??null,v.gloveSize??null,v.shoeSize??null,v.profession??null,v.education??null,v.institution??null,
   v.cnhCategory??null,v.languages,v.radioamateurCallSign??null,v.operationRegion??null,v.skills,v.validatedSkills,
   JSON.stringify(v.certifications),JSON.stringify(v.history),v.notes??null,id,o
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
   VALUES($1,'VOLUNTEER_UPDATED','volunteer',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
   a.userId,id,req.ip,req.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(v)
  ]);
  return r.rows[0];
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
  const adapter=String(req.headers["x-sigdec-adapter"]??"SIGDEC_GENERIC_V1");
  let normalized;
  try{normalized=normalizeMonitoringPayload(adapter,req.body)}catch(error){
   return reply.code(400).send({error:error instanceof Error?error.message:"INVALID_INPUT"});
  }
  const key=await db.query(`SELECT k.id AS "keyId",k.organization_id AS "organizationId",k.station_id AS "stationId"
   FROM monitoring_ingest_keys k JOIN monitoring_stations s ON s.id=k.station_id
   WHERE k.token_hash=$1 AND k.active=true AND s.active=true`,[tokenHash(token)]);
  const k=key.rows[0] as {keyId:string;organizationId:string;stationId:string}|undefined;if(!k)return reply.code(401).send({error:"INVALID_INGEST_KEY"});
  if(normalized.adapter==="GEOPIXEL_BRIDGE_V1"){
   const connector=await db.query(`SELECT external_reference AS "externalReference" FROM monitoring_connectors
     WHERE organization_id=$1 AND station_id=$2 AND provider_code='GEOPIXEL' AND status='ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`,[k.organizationId,k.stationId]);
   const active=connector.rows[0] as {externalReference?:string|null}|undefined;
   if(!active)return reply.code(409).send({error:"GEOPIXEL_CONNECTOR_NOT_ACTIVE"});
   if(normalized.externalStationId&&active.externalReference&&normalized.externalStationId!==active.externalReference){
    return reply.code(409).send({error:"GEOPIXEL_STATION_MISMATCH"});
   }
  }
  const v={measuredAt:normalized.measuredAt,metric:normalized.metric,value:normalized.value,unit:normalized.unit,source:normalized.adapter.toLowerCase()} as z.infer<typeof readingSchema>;
  const readingId=await persistMonitoringReading(k.organizationId,k.stationId,v);
  await db.query("UPDATE monitoring_ingest_keys SET last_used_at=now() WHERE id=$1",[k.keyId]);
  await db.query(`UPDATE monitoring_connectors SET last_success_at=now(),last_error_at=NULL,last_error=NULL,updated_at=now()
    WHERE organization_id=$1 AND station_id=$2 AND status='ACTIVE'`,[k.organizationId,k.stationId]);
  await db.query(`INSERT INTO audit_logs(action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`,["MONITORING_EXTERNAL_READING","monitoring_reading",String(readingId??""),req.ip,req.headers["user-agent"]??null,JSON.stringify({stationId:k.stationId,metric:v.metric,value:v.value,unit:v.unit}),JSON.stringify({ingestKeyId:k.keyId,adapter:normalized.adapter,externalStationId:normalized.externalStationId??null})]);
  return reply.code(201).send({ok:true,readingId,adapter:normalized.adapter});
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
 app.get("/api/v1/cobrade/catalog",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const q=String((req.query as {search?:string})?.search??"").trim();
  const r=await db.query(`SELECT code,name,group_name AS "group",subgroup_name AS "subgroup",type_name AS "type",subtype_name AS "subtype",source_name AS "sourceName",source_version AS "sourceVersion",imported_at AS "importedAt"
    FROM cobrade_catalog WHERE organization_id=$1 AND active=true AND ($2='' OR code ILIKE '%'||$2||'%' OR name ILIKE '%'||$2||'%')
    ORDER BY code LIMIT 500`,[o,q]);
  return {items:r.rows};
 });
 app.post("/api/v1/cobrade/catalog/import",{preHandler:requirePermission("cobrade.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=cobradeImportSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  let items;try{items=parseCobradeCatalogCsv(p.data.csv)}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"INVALID_CSV"});}
  const client=await db.connect();try{await client.query("BEGIN");
   for(const item of items){
    await client.query(`INSERT INTO cobrade_catalog(organization_id,code,name,group_name,subgroup_name,type_name,subtype_name,source_name,source_version,imported_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,group_name=EXCLUDED.group_name,subgroup_name=EXCLUDED.subgroup_name,type_name=EXCLUDED.type_name,subtype_name=EXCLUDED.subtype_name,source_name=EXCLUDED.source_name,source_version=EXCLUDED.source_version,active=true,imported_by=EXCLUDED.imported_by,imported_at=now()`,[o,item.code,item.name,item.group??null,item.subgroup??null,item.type??null,item.subtype??null,p.data.sourceName??null,p.data.sourceVersion??null,a.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
     VALUES($1,$2,$3,NULL,$4,$5,$6,$7)`,[a.userId,"COBRADE_CATALOG_IMPORTED","cobrade_catalog",req.ip,req.headers["user-agent"]??null,JSON.stringify({count:items.length}),JSON.stringify({sourceName:p.data.sourceName??null,sourceVersion:p.data.sourceVersion??null})]);
   await client.query("COMMIT");return reply.code(201).send({imported:items.length});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
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
  const catalogCount=await db.query(`SELECT count(*)::int AS count FROM cobrade_catalog WHERE organization_id=$1 AND active=true`,[o]);
  if(Number(catalogCount.rows[0]?.count??0)>0){const valid=await db.query(`SELECT 1 FROM cobrade_catalog WHERE organization_id=$1 AND code=$2 AND active=true`,[o,v.cobradeCode]);if(!valid.rows[0])return reply.code(400).send({error:"COBRADE_NOT_IN_CATALOG"});}
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
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT d.id,d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",
   d.household_id AS "householdId",d.notes,d.duplicate_acknowledged AS "duplicateAcknowledged",d.duplicate_reason AS "duplicateReason",
   i.protocol,du.matricula AS "deliveredByMatricula",du.display_name AS "deliveredByName",COALESCE(jsonb_agg(jsonb_build_object('itemId',di.item_id,'name',hi.name,'unit',hi.unit,'quantity',di.quantity)
    ORDER BY hi.name) FILTER(WHERE di.item_id IS NOT NULL),'[]'::jsonb) AS items
   FROM humanitarian_deliveries d
   LEFT JOIN incidents i ON i.id=d.incident_id
   JOIN users du ON du.id=d.delivered_by
   LEFT JOIN humanitarian_delivery_items di ON di.delivery_id=d.id
   LEFT JOIN humanitarian_items hi ON hi.id=di.item_id
   WHERE d.organization_id=$1 GROUP BY d.id,i.protocol ORDER BY d.delivered_at DESC LIMIT 200`,[o]); return {items:r.rows};
 });
 app.get("/api/v1/humanitarian/shelters",{preHandler:requirePermission("humanitarian.read")},async req=>{const o=org(authFrom(req).organizationId),r=await db.query('SELECT id,name,address_line AS "addressLine",neighborhood,capacity_people AS "capacityPeople",status,notes FROM shelters WHERE organization_id=$1 ORDER BY name',[o]);return {items:r.rows};});
 app.post("/api/v1/humanitarian/shelters",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const o=org(authFrom(req).organizationId),p=shelterSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO shelters(organization_id,name,address_line,neighborhood,capacity_people,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[o,v.name,v.addressLine??null,v.neighborhood??null,v.capacityPeople,v.status,v.notes??null]);return reply.code(201).send(r.rows[0]);});
 app.post("/api/v1/humanitarian/households",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{const o=org(authFrom(req).organizationId),p=householdSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data,r=await db.query('INSERT INTO assisted_households(organization_id,incident_id,shelter_id,responsible_name,phone,address_origin,neighborhood_origin,adults,children,elderly,persons_with_disability,condition,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',[o,v.incidentId??null,v.shelterId??null,v.responsibleName,v.phone??null,v.addressOrigin??null,v.neighborhoodOrigin??null,v.adults,v.children,v.elderly,v.personsWithDisability,v.condition,v.notes??null]);return reply.code(201).send(r.rows[0]);});
 app.post("/api/v1/humanitarian/deliveries",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=deliverySchema.safeParse(req.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,itemIds=[...new Set(v.items.map(x=>x.itemId))];
  if(v.householdId){const h=await db.query("SELECT 1 FROM assisted_households WHERE id=$1 AND organization_id=$2",[v.householdId,o]);if(!h.rows[0])return reply.code(404).send({error:"HOUSEHOLD_NOT_FOUND"});}
  const validItems=await db.query("SELECT id,name FROM humanitarian_items WHERE organization_id=$1 AND active=true AND id=ANY($2::uuid[])",[o,itemIds]);
  if(validItems.rowCount!==itemIds.length)return reply.code(400).send({error:"INVALID_DELIVERY_ITEM"});
  const dup=await db.query(`SELECT d.id,d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",
    array_agg(DISTINCT di.item_id::text) AS "itemIds"
   FROM humanitarian_deliveries d JOIN humanitarian_delivery_items di ON di.delivery_id=d.id
   WHERE d.organization_id=$1 AND d.delivered_at>=now()-interval '24 hours'
    AND (($2::uuid IS NOT NULL AND d.household_id=$2) OR ($2::uuid IS NULL AND lower(d.recipient_name)=lower($3)))
    AND di.item_id=ANY($4::uuid[])
   GROUP BY d.id ORDER BY d.delivered_at DESC LIMIT 10`,[o,v.householdId??null,v.recipientName,itemIds]);
  if(dup.rows.length&&!v.duplicateAcknowledged){
   return reply.code(409).send({error:"POSSIBLE_DUPLICATE_DELIVERY",message:"Há entrega recente para o mesmo beneficiário com item coincidente. Confirme e justifique se a nova entrega for necessária.",duplicates:dup.rows});
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT id FROM humanitarian_items WHERE organization_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",[o,itemIds]);
   for(const item of v.items){
    const bal=await client.query(`SELECT COALESCE(sum(CASE WHEN movement_type IN ('IN','ADJUST_IN') THEN quantity ELSE -quantity END),0)::float8 AS balance
     FROM humanitarian_stock_movements WHERE organization_id=$1 AND item_id=$2`,[o,item.itemId]);
    if(Number(bal.rows[0]?.balance??0)<item.quantity)throw Object.assign(new Error("Estoque insuficiente para um dos itens."),{statusCode:409,code:"INSUFFICIENT_STOCK",itemId:item.itemId,balance:Number(bal.rows[0]?.balance??0)});
   }
   const d=await client.query(`INSERT INTO humanitarian_deliveries(
     organization_id,incident_id,household_id,recipient_name,notes,delivered_by,duplicate_acknowledged,duplicate_reason
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,delivered_at AS "deliveredAt"`,[
     o,v.incidentId??null,v.householdId??null,v.recipientName,v.notes??null,a.userId,v.duplicateAcknowledged,v.duplicateReason??null
    ]);
   const deliveryId=String(d.rows[0].id);
   for(const item of v.items){
    await client.query("INSERT INTO humanitarian_delivery_items(delivery_id,item_id,quantity) VALUES($1,$2,$3)",[deliveryId,item.itemId,item.quantity]);
    await client.query(`INSERT INTO humanitarian_stock_movements(organization_id,item_id,movement_type,quantity,reference,notes,created_by)
     VALUES($1,$2,'OUT',$3,$4,$5,$6)`,[o,item.itemId,item.quantity,`delivery:${deliveryId}`,v.notes??null,a.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'HUMANITARIAN_DELIVERY_CREATED','humanitarian_delivery',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    a.userId,deliveryId,req.ip,req.headers["user-agent"]??null,JSON.stringify({recipientName:v.recipientName,items:v.items}),
    JSON.stringify({duplicateAcknowledged:v.duplicateAcknowledged,duplicateReason:v.duplicateReason??null})
   ]);
   await client.query("COMMIT");
   return reply.code(201).send({id:deliveryId,deliveredAt:d.rows[0].deliveredAt,duplicateAcknowledged:v.duplicateAcknowledged});
  }catch(error){
   await client.query("ROLLBACK");
   const e=error as any;
   if(e?.statusCode)return reply.code(e.statusCode).send({error:e.code??"DELIVERY_FAILED",message:e.message,itemId:e.itemId,balance:e.balance});
   throw error;
  }finally{client.release();}
 });
 app.get("/api/v1/inventory/items",{preHandler:requirePermission("humanitarian.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT i.id,i.code,i.name,i.unit,i.category,
   COALESCE(sum(CASE WHEN m.movement_type IN ('IN','ADJUST_IN') THEN m.quantity ELSE -m.quantity END),0)::float8 AS balance
   FROM humanitarian_items i LEFT JOIN humanitarian_stock_movements m ON m.item_id=i.id AND m.organization_id=i.organization_id
   WHERE i.organization_id=$1 AND i.active=true GROUP BY i.id ORDER BY i.name`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/inventory/items",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{
  const o=org(authFrom(req).organizationId),p=itemSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const r=await db.query(`INSERT INTO humanitarian_items(organization_id,code,name,unit,category) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,unit=EXCLUDED.unit,category=EXCLUDED.category,active=true
   RETURNING id`,[o,v.code,v.name,v.unit,v.category]);return reply.code(201).send(r.rows[0]);
 });
 app.post("/api/v1/inventory/movements",{preHandler:requirePermission("humanitarian.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=stockSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const client=await db.connect();try{await client.query("BEGIN");
   const item=await client.query("SELECT id FROM humanitarian_items WHERE id=$1 AND organization_id=$2 AND active=true FOR UPDATE",[v.itemId,o]);
   if(!item.rows[0]){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}
   if(v.movementType==="OUT"||v.movementType==="ADJUST_OUT"){
    const bal=await client.query(`SELECT COALESCE(sum(CASE WHEN movement_type IN ('IN','ADJUST_IN') THEN quantity ELSE -quantity END),0)::float8 AS balance
     FROM humanitarian_stock_movements WHERE organization_id=$1 AND item_id=$2`,[o,v.itemId]);
    if(Number(bal.rows[0]?.balance??0)<v.quantity){await client.query("ROLLBACK");return reply.code(409).send({error:"INSUFFICIENT_STOCK",balance:Number(bal.rows[0]?.balance??0)});}
   }
   const r=await client.query(`INSERT INTO humanitarian_stock_movements(organization_id,item_id,movement_type,quantity,reference,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[o,v.itemId,v.movementType,v.quantity,v.reference??null,v.notes??null,a.userId]);
   await client.query("COMMIT");return reply.code(201).send(r.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
 });
}
