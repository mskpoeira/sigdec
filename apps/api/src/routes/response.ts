import type { FastifyInstance } from "fastify";
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


const shelterSchema=z.object({name:z.string().trim().min(2).max(200),addressLine:z.string().trim().max(300).optional(),neighborhood:z.string().trim().max(120).optional(),capacityPeople:z.number().int().min(0),status:z.enum(["STANDBY","OPEN","FULL","CLOSED"]).default("STANDBY"),notes:z.string().trim().max(3000).optional()});
const householdSchema=z.object({incidentId:z.string().uuid().optional(),shelterId:z.string().uuid().optional(),responsibleName:z.string().trim().min(3).max(200),phone:z.string().trim().max(50).optional(),addressOrigin:z.string().trim().max(300).optional(),neighborhoodOrigin:z.string().trim().max(120).optional(),adults:z.number().int().min(0).default(0),children:z.number().int().min(0).default(0),elderly:z.number().int().min(0).default(0),personsWithDisability:z.number().int().min(0).default(0),condition:z.enum(["DISPLACED","HOMELESS"]),notes:z.string().trim().max(3000).optional()});
const itemSchema=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(2).max(200),unit:z.string().trim().min(1).max(30),category:z.string().trim().min(1).max(50)});
const stockSchema=z.object({itemId:z.string().uuid(),movementType:z.enum(["IN","OUT","ADJUST_IN","ADJUST_OUT"]),quantity:z.number().positive(),reference:z.string().trim().max(200).optional(),notes:z.string().trim().max(2000).optional()});

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
  const v=p.data; await db.query(`INSERT INTO monitoring_readings(station_id,measured_at,metric,value,unit,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(station_id,measured_at,metric) DO UPDATE SET value=EXCLUDED.value,unit=EXCLUDED.unit,source=EXCLUDED.source`,[id,v.measuredAt,v.metric,v.value,v.unit,v.source]); return reply.code(201).send({ok:true});
 });
 app.get("/api/v1/humanitarian/households",{preHandler:requirePermission("humanitarian.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT h.id,h.responsible_name AS "responsibleName",h.condition,h.adults,h.children,h.elderly,h.persons_with_disability AS "personsWithDisability",h.admitted_at AS "admittedAt",s.name AS "shelterName",i.protocol FROM assisted_households h LEFT JOIN shelters s ON s.id=h.shelter_id LEFT JOIN incidents i ON i.id=h.incident_id WHERE h.organization_id=$1 ORDER BY h.admitted_at DESC`,[o]); return {items:r.rows};
 });
 app.get("/api/v1/humanitarian/deliveries",{preHandler:requirePermission("humanitarian.read")},async req=>{
  const o=org(authFrom(req).organizationId),r=await db.query(`SELECT d.id,d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",d.notes,i.protocol FROM humanitarian_deliveries d LEFT JOIN incidents i ON i.id=d.incident_id WHERE d.organization_id=$1 ORDER BY d.delivered_at DESC LIMIT 200`,[o]); return {items:r.rows};
 });
}
