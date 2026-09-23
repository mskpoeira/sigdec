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
const thresholdSchema=z.object({stationId:z.string().uuid(),metric:z.string().trim().min(1).max(50),severity:z.enum(["WATCH","WARNING","EMERGENCY"]),comparison:z.enum(["GTE","LTE"]),thresholdValue:z.number(),unit:z.string().trim().min(1).max(30),title:z.string().trim().min(3).max(240),guidance:z.string().trim().max(3000).optional()});
const monitoringEventStatusSchema=z.object({status:z.enum(["ACKNOWLEDGED","CLOSED"])});
const ingestKeySchema=z.object({name:z.string().trim().min(3).max(120)});
const externalReadingSchema=z.object({measuredAt:z.coerce.date(),metric:z.string().trim().min(1).max(50),value:z.number(),unit:z.string().trim().min(1).max(30)});


function tokenHash(token:string){return createHash("sha256").update(token).digest("hex");}
async function persistMonitoringReading(organizationId:string,stationId:string,v:z.infer<typeof readingSchema>){
 const reading=await db.query(`INSERT INTO monitoring_readings(station_id,measured_at,metric,value,unit,source) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT(station_id,measured_at,metric) DO UPDATE SET value=EXCLUDED.value,unit=EXCLUDED.unit,source=EXCLUDED.source
  RETURNING id`,[stationId,v.measuredAt,v.metric,v.value,v.unit,v.source]);
 const readingId=reading.rows[0]?.id;
 if(readingId){
  await db.query(`INSERT INTO monitoring_events(organization_id,station_id,reading_id,threshold_id,severity,metric,observed_value,threshold_value,unit,title,guidance)
   SELECT t.organization_id,t.station_id,$1,t.id,t.severity,t.metric,$2,t.threshold_value,t.unit,t.title,t.guidance
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
  const r=await db.query(`SELECT id,name,active,created_at AS "createdAt",last_used_at AS "lastUsedAt" FROM monitoring_ingest_keys WHERE station_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[id,o]);
  return {items:r.rows};
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
 app.get("/api/v1/monitoring/readings/latest",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT DISTINCT ON (r.station_id,r.metric) r.id,r.station_id AS "stationId",s.name AS "stationName",s.code AS "stationCode",r.metric,r.value,r.unit,r.source,r.measured_at AS "measuredAt"
   FROM monitoring_readings r JOIN monitoring_stations s ON s.id=r.station_id
   WHERE s.organization_id=$1 ORDER BY r.station_id,r.metric,r.measured_at DESC`,[o]);
  return {items:r.rows};
 });
 app.get("/api/v1/monitoring/thresholds",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT t.id,t.station_id AS "stationId",s.name AS "stationName",t.metric,t.severity,t.comparison,t.threshold_value AS "thresholdValue",t.unit,t.title,t.guidance,t.active
   FROM monitoring_thresholds t JOIN monitoring_stations s ON s.id=t.station_id WHERE t.organization_id=$1 ORDER BY s.name,t.metric,t.threshold_value`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/monitoring/thresholds",{preHandler:requirePermission("monitoring.manage")},async(req,reply)=>{
  const a=authFrom(req),o=org(a.organizationId),p=thresholdSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});const v=p.data;
  const station=await db.query("SELECT 1 FROM monitoring_stations WHERE id=$1 AND organization_id=$2",[v.stationId,o]);if(!station.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`INSERT INTO monitoring_thresholds(organization_id,station_id,metric,severity,comparison,threshold_value,unit,title,guidance,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[o,v.stationId,v.metric,v.severity,v.comparison,v.thresholdValue,v.unit,v.title,v.guidance??null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.get("/api/v1/monitoring/events",{preHandler:requirePermission("monitoring.read")},async req=>{
  const o=org(authFrom(req).organizationId);
  const r=await db.query(`SELECT e.id,e.station_id AS "stationId",s.name AS "stationName",s.code AS "stationCode",e.severity,e.metric,e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,e.title,e.guidance,e.status,e.created_at AS "createdAt",a.id AS "alertId",a.status AS "alertStatus"
   FROM monitoring_events e JOIN monitoring_stations s ON s.id=e.station_id LEFT JOIN alerts a ON a.monitoring_event_id=e.id WHERE e.organization_id=$1 ORDER BY e.created_at DESC LIMIT 200`,[o]);
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
