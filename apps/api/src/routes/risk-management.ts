import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";

function org(request:FastifyRequest){
 const value=authFrom(request).organizationId;
 if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});
 return value;
}
const uuid=z.string().uuid();
function xmlEscape(value:unknown){return String(value??"").replace(/[&<>"\']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&apos;"}[ch]??ch));}
const optionalUuid=z.string().uuid().optional().or(z.literal(""));
const coords=z.object({
 latitude:z.number().min(-90).max(90).optional(),
 longitude:z.number().min(-180).max(180).optional()
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});

const riskAreaInput=z.object({
 code:z.string().trim().min(2).max(80),name:z.string().trim().min(3).max(240),
 neighborhood:z.string().trim().max(160).optional().default(""),
 hazardType:z.string().trim().min(2).max(80),riskLevel:z.enum(["R1","R2","R3","R4"]).default("R2"),
 pmrrReference:z.string().trim().max(200).optional().default(""),
 exposedBuildings:z.number().int().nonnegative().max(1000000).default(0),
 exposedPeople:z.number().int().nonnegative().max(10000000).default(0),
 latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),
 boundaryGeojson:z.record(z.string(),z.unknown()).optional(),safePoints:z.array(z.unknown()).max(500).default([]),
 escapeRoutes:z.array(z.unknown()).max(500).default([]),notes:z.string().trim().max(12000).optional().default("")
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});
const statusOnly=z.object({status:z.string().trim().min(2).max(40)});

const mitigationInput=z.object({
 riskAreaId:optionalUuid,code:z.string().trim().min(2).max(80),title:z.string().trim().min(3).max(300),
 interventionType:z.string().trim().min(2).max(100),priority:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("HIGH"),
 responsibleDepartment:z.string().trim().max(200).optional().default(""),fundingSource:z.string().trim().max(240).optional().default(""),
 estimatedCost:z.number().nonnegative().optional(),contractedCost:z.number().nonnegative().optional(),
 startsAt:z.coerce.date().optional(),expectedEndAt:z.coerce.date().optional(),
 residualRisk:z.string().trim().max(10).optional().default(""),notes:z.string().trim().max(12000).optional().default("")
});

const nucleoInput=z.object({
 code:z.string().trim().min(2).max(80),name:z.string().trim().min(3).max(240),neighborhood:z.string().trim().max(160).optional().default(""),
 coordinatorName:z.string().trim().max(200).optional().default(""),phone:z.string().trim().max(80).optional().default(""),
 email:z.string().trim().email().max(254).optional().or(z.literal("")).default(""),membersCount:z.number().int().nonnegative().max(100000).default(0),
 riskAreaIds:z.array(z.string().uuid()).max(200).default([]),safePoints:z.array(z.unknown()).max(500).default([]),
 notes:z.string().trim().max(12000).optional().default("")
});

const warningAssetInput=z.object({
 code:z.string().trim().min(2).max(80),name:z.string().trim().min(3).max(240),
 assetType:z.enum(["SIREN","LOUDSPEAKER","RADIO_BASE","CELL_BROADCAST","SMS","OTHER"]),
 addressLine:z.string().trim().max(300).optional().default(""),neighborhood:z.string().trim().max(160).optional().default(""),
 latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),
 batteryPercent:z.number().min(0).max(100).optional(),responsibleName:z.string().trim().max(200).optional().default(""),
 responsiblePhone:z.string().trim().max(80).optional().default(""),nextTestAt:z.coerce.date().optional(),
 notes:z.string().trim().max(8000).optional().default("")
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});

const warningActivationInput=z.object({
 incidentId:optionalUuid,riskAreaId:optionalUuid,severity:z.enum(["INFO","WATCH","WARNING","EMERGENCY"]),
 title:z.string().trim().min(3).max(300),message:z.string().trim().min(3).max(12000),
 instruction:z.string().trim().max(8000).optional().default(""),capIdentifier:z.string().trim().max(200).optional().default(""),
 channels:z.array(z.string().trim().min(1).max(80)).min(1).max(30),targetAreaGeojson:z.record(z.string(),z.unknown()).optional()
});
const warningStatus=z.object({status:z.enum(["DRAFT","PUBLISHED","ENDED","CANCELLED"])});

const evacuationInput=z.object({
 riskAreaId:optionalUuid,code:z.string().trim().min(2).max(80),name:z.string().trim().min(3).max(240),
 originText:z.string().trim().max(300).optional().default(""),destinationText:z.string().trim().min(2).max(300),
 distanceMeters:z.number().int().nonnegative().optional(),accessible:z.boolean().default(false),
 routeGeojson:z.record(z.string(),z.unknown()).optional(),notes:z.string().trim().max(8000).optional().default("")
});

const bulletinInput=z.object({
 incidentId:optionalUuid,warningActivationId:optionalUuid,title:z.string().trim().min(3).max(300),
 content:z.string().trim().min(5).max(20000),audience:z.string().trim().max(200).optional().default("População em geral"),
 channels:z.array(z.string().trim().min(1).max(80)).max(30).default([])
});
const bulletinStatus=z.object({status:z.enum(["DRAFT","APPROVED","PUBLISHED","EXPIRED","CANCELLED"]),expiresAt:z.coerce.date().optional()});

const damageInput=z.object({
 incidentId:z.string().uuid(),assessmentType:z.enum(["FIELD","FIDE","DMATE","FINAL"]).default("FIELD"),
 affectedPeople:z.number().int().nonnegative().default(0),displacedPeople:z.number().int().nonnegative().default(0),
 homelessPeople:z.number().int().nonnegative().default(0),injuredPeople:z.number().int().nonnegative().default(0),
 deaths:z.number().int().nonnegative().default(0),missingPeople:z.number().int().nonnegative().default(0),
 housesDamaged:z.number().int().nonnegative().default(0),housesDestroyed:z.number().int().nonnegative().default(0),
 publicDamage:z.number().nonnegative().default(0),privateDamage:z.number().nonnegative().default(0),
 environmentalDamage:z.string().trim().max(12000).optional().default(""),publicLoss:z.number().nonnegative().default(0),
 privateLoss:z.number().nonnegative().default(0),summary:z.string().trim().max(12000).optional().default("")
});
const damageItemInput=z.object({
 category:z.string().trim().min(2).max(80),description:z.string().trim().min(3).max(5000),
 quantity:z.number().nonnegative().optional(),unit:z.string().trim().max(40).optional().default(""),
 estimatedValue:z.number().nonnegative().optional(),latitude:z.number().min(-90).max(90).optional(),
 longitude:z.number().min(-180).max(180).optional(),incidentAttachmentId:optionalUuid
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});

const infrastructureInput=z.object({
 code:z.string().trim().min(2).max(80),name:z.string().trim().min(3).max(240),
 category:z.enum(["WATER","ENERGY","TELECOM","HEALTH","EDUCATION","ROAD","BRIDGE","DRAINAGE","FUEL","PUBLIC_SAFETY","SHELTER","OTHER"]),
 ownerName:z.string().trim().max(240).optional().default(""),responsibleName:z.string().trim().max(200).optional().default(""),
 responsiblePhone:z.string().trim().max(80).optional().default(""),addressLine:z.string().trim().max(300).optional().default(""),
 neighborhood:z.string().trim().max(160).optional().default(""),latitude:z.number().min(-90).max(90).optional(),
 longitude:z.number().min(-180).max(180).optional(),criticality:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("HIGH"),
 redundancy:z.string().trim().max(8000).optional().default(""),backupPower:z.boolean().default(false),
 autonomyHours:z.number().nonnegative().optional(),notes:z.string().trim().max(12000).optional().default("")
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});
const infrastructureEvent=z.object({
 incidentId:optionalUuid,status:z.enum(["OPERATIONAL","DEGRADED","INTERRUPTED","RESTORED"]),
 impact:z.string().trim().max(8000).optional().default(""),estimatedRestoreAt:z.coerce.date().optional(),
 notes:z.string().trim().max(8000).optional().default("")
});

const animalInput=z.object({
 incidentId:optionalUuid,shelterId:optionalUuid,species:z.string().trim().min(2).max(80),
 quantity:z.number().int().positive().max(10000).default(1),animalName:z.string().trim().max(160).optional().default(""),
 identification:z.string().trim().max(200).optional().default(""),tutorName:z.string().trim().max(200).optional().default(""),
 tutorPhone:z.string().trim().max(80).optional().default(""),foundLocation:z.string().trim().max(300).optional().default(""),
 latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),
 destination:z.string().trim().max(300).optional().default(""),healthStatus:z.enum(["UNKNOWN","STABLE","INJURED","CRITICAL","DECEASED"]).default("UNKNOWN"),
 veterinaryNotes:z.string().trim().max(12000).optional().default(""),microchip:z.string().trim().max(160).optional().default(""),
 vaccinationStatus:z.string().trim().max(200).optional().default("")
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});
const animalStatus=z.object({status:z.enum(["RESCUED","SHELTERED","VETERINARY","RETURNED","TRANSFERRED","DECEASED"]),destination:z.string().trim().max(300).optional()});

const costInput=z.object({
 incidentId:optionalUuid,category:z.string().trim().min(2).max(80),description:z.string().trim().min(3).max(5000),
 supplier:z.string().trim().max(240).optional().default(""),documentReference:z.string().trim().max(200).optional().default(""),
 quantity:z.number().nonnegative().optional(),unit:z.string().trim().max(40).optional().default(""),
 amount:z.number().nonnegative(),fundingSource:z.string().trim().max(200).optional().default(""),occurredAt:z.coerce.date().optional()
});

const lessonInput=z.object({
 incidentId:optionalUuid,operationId:optionalUuid,category:z.string().trim().min(2).max(80),
 title:z.string().trim().min(3).max(300),observation:z.string().trim().min(5).max(12000),
 correctiveAction:z.string().trim().max(12000).optional().default(""),responsibleName:z.string().trim().max(200).optional().default(""),
 dueAt:z.coerce.date().optional()
});
const lessonStatus=z.object({status:z.enum(["OPEN","IN_PROGRESS","VERIFIED","CLOSED"]),effectivenessNotes:z.string().trim().max(8000).optional().default("")});

const readinessInput=z.object({
 resourceType:z.enum(["VEHICLE","EQUIPMENT","RADIO","GENERATOR","BOAT","PUMP","OTHER"]),resourceId:optionalUuid,
 code:z.string().trim().min(1).max(100),name:z.string().trim().min(2).max(240),
 readinessStatus:z.enum(["READY","RESTRICTED","MAINTENANCE","UNAVAILABLE"]).default("READY"),
 nextMaintenanceAt:z.coerce.date().optional(),calibrationDueAt:z.coerce.date().optional(),
 fuelLevelPercent:z.number().min(0).max(100).optional(),batteryPercent:z.number().min(0).max(100).optional(),
 locationText:z.string().trim().max(300).optional().default(""),notes:z.string().trim().max(8000).optional().default("")
});

const actionPlanItem=z.object({
 periodId:optionalUuid,itemType:z.enum(["OBJECTIVE","ASSIGNMENT","SAFETY","MEDICAL","COMMUNICATION","LOGISTICS","DEMOBILIZATION"]),
 title:z.string().trim().min(3).max(300),detail:z.string().trim().max(12000).optional().default(""),
 assignedTeamId:optionalUuid,assignedUserId:optionalUuid,dueAt:z.coerce.date().optional()
});
const actionPlanStatus=z.object({status:z.enum(["OPEN","IN_PROGRESS","DONE","CANCELLED"])});

const shelterReadiness=z.object({
 responsibleName:z.string().trim().max(200).optional().default(""),contactPhone:z.string().trim().max(80).optional().default(""),
 accessible:z.boolean().default(false),kitchenAvailable:z.boolean().default(false),generatorAvailable:z.boolean().default(false),
 petAreaAvailable:z.boolean().default(false),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),
 readinessNotes:z.string().trim().max(8000).optional().default("")
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});

export async function riskManagementRoutes(app:FastifyInstance){
 app.get("/api/v1/incidents/:id/risk-context",{preHandler:requirePermission("incidents.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const incident=await db.query(`SELECT id,protocol,summary,latitude,longitude
    FROM incidents WHERE id=$1 AND organization_id=$2`,[id,o]);
  const current=incident.rows[0];
  if(!current)return reply.code(404).send({error:"NOT_FOUND"});
  if(current.latitude==null||current.longitude==null)return {georeferenced:false,incident:{id:current.id,protocol:current.protocol},riskAreas:[],warningAssets:[],criticalInfrastructures:[],shelters:[]};
  const [riskAreas,warningAssets,infrastructure,shelters]=await Promise.all([
   db.query(`SELECT id,code,name,risk_level AS "riskLevel",hazard_type AS "hazardType",status,
      exposed_people AS "exposedPeople",exposed_buildings AS "exposedBuildings",
      round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography))::int AS "distanceMeters"
     FROM territorial_risk_areas
     WHERE organization_id=$1 AND status<>'INACTIVE' AND location IS NOT NULL
       AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography,5000)
     ORDER BY "distanceMeters",CASE risk_level WHEN 'R4' THEN 1 WHEN 'R3' THEN 2 ELSE 3 END LIMIT 20`,
     [o,current.longitude,current.latitude]),
   db.query(`SELECT id,code,name,asset_type AS "assetType",status,battery_percent::float8 AS "batteryPercent",
      round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography))::int AS "distanceMeters"
     FROM warning_assets
     WHERE organization_id=$1 AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography,8000)
     ORDER BY "distanceMeters" LIMIT 20`,[o,current.longitude,current.latitude]),
   db.query(`SELECT id,code,name,category,operational_status AS "operationalStatus",criticality,
      backup_power AS "backupPower",autonomy_hours::float8 AS "autonomyHours",
      round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography))::int AS "distanceMeters"
     FROM critical_infrastructures
     WHERE organization_id=$1 AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography,10000)
     ORDER BY CASE criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,"distanceMeters" LIMIT 30`,[o,current.longitude,current.latitude]),
   db.query(`SELECT s.id,s.name,s.status,s.capacity_people AS "capacityPeople",s.accessible,
      s.generator_available AS "generatorAvailable",s.pet_area_available AS "petAreaAvailable",
      COALESCE((SELECT sum(adults+children+elderly+persons_with_disability)
        FROM assisted_households h WHERE h.shelter_id=s.id AND h.departed_at IS NULL),0)::int AS "currentPeople",
      round(ST_Distance(s.location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography))::int AS "distanceMeters"
     FROM shelters s
     WHERE s.organization_id=$1 AND s.location IS NOT NULL AND ST_DWithin(s.location,ST_SetSRID(ST_MakePoint($2::double precision,$3::double precision),4326)::geography,15000)
     ORDER BY CASE s.status WHEN 'OPEN' THEN 1 WHEN 'STANDBY' THEN 2 ELSE 3 END,"distanceMeters" LIMIT 20`,[o,current.longitude,current.latitude])
  ]);
  return {georeferenced:true,incident:{id:current.id,protocol:current.protocol,latitude:current.latitude,longitude:current.longitude},
   riskAreas:riskAreas.rows,warningAssets:warningAssets.rows,criticalInfrastructures:infrastructure.rows,shelters:shelters.rows};
 });

 app.get("/api/v1/risk-management/summary",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT
   (SELECT count(*) FROM territorial_risk_areas WHERE organization_id=$1 AND status<>'INACTIVE')::int AS "riskAreas",
   (SELECT count(*) FROM territorial_risk_areas WHERE organization_id=$1 AND risk_level='R4' AND status<>'INACTIVE')::int AS "r4Areas",
   (SELECT count(*) FROM warning_assets WHERE organization_id=$1 AND status='OPERATIONAL')::int AS "operationalWarningAssets",
   (SELECT count(*) FROM warning_activations WHERE organization_id=$1 AND status='PUBLISHED')::int AS "activeWarnings",
   (SELECT count(*) FROM mitigation_projects WHERE organization_id=$1 AND status NOT IN('COMPLETED','CANCELLED'))::int AS "openMitigationProjects",
   (SELECT count(*) FROM community_nuclei WHERE organization_id=$1 AND active=true)::int AS "activeNuclei",
   (SELECT count(*) FROM critical_infrastructures WHERE organization_id=$1 AND operational_status<>'OPERATIONAL')::int AS "degradedInfrastructure",
   (SELECT count(*) FROM animal_rescues WHERE organization_id=$1 AND status NOT IN('RETURNED','TRANSFERRED','DECEASED'))::int AS "animalsInCare",
   (SELECT COALESCE(sum(amount),0)::float8 FROM disaster_cost_entries WHERE organization_id=$1)::float8 AS "recordedCosts"`,[o]);
  return r.rows[0];
 });

 app.get("/api/v1/risk-areas",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,code,name,neighborhood,hazard_type AS "hazardType",risk_level AS "riskLevel",
   pmrr_reference AS "pmrrReference",status,exposed_buildings AS "exposedBuildings",exposed_people AS "exposedPeople",
   latitude,longitude,boundary_geojson AS "boundaryGeojson",safe_points AS "safePoints",escape_routes AS "escapeRoutes",
   notes,last_reviewed_at AS "lastReviewedAt",created_at AS "createdAt",updated_at AS "updatedAt"
   FROM territorial_risk_areas WHERE organization_id=$1 ORDER BY CASE risk_level WHEN 'R4' THEN 1 WHEN 'R3' THEN 2 WHEN 'R2' THEN 3 ELSE 4 END,code`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/risk-areas",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=riskAreaInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO territorial_risk_areas(organization_id,code,name,neighborhood,hazard_type,risk_level,pmrr_reference,exposed_buildings,exposed_people,latitude,longitude,boundary_geojson,safe_points,escape_routes,notes,last_reviewed_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,now(),$16) RETURNING id`,
   [o,v.code,v.name,v.neighborhood||null,v.hazardType,v.riskLevel,v.pmrrReference||null,v.exposedBuildings,v.exposedPeople,v.latitude??null,v.longitude??null,
    v.boundaryGeojson?JSON.stringify(v.boundaryGeojson):null,JSON.stringify(v.safePoints),JSON.stringify(v.escapeRoutes),v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/risk-areas/:id/status",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=statusOnly.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success||!["ACTIVE","MITIGATED","MONITORING","INACTIVE"].includes(p.data.status))return reply.code(400).send({error:"INVALID_INPUT"});
  const r=await db.query("UPDATE territorial_risk_areas SET status=$3,updated_at=now(),last_reviewed_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status",[id,o,p.data.status]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/mitigation-projects",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT p.id,p.code,p.title,p.intervention_type AS "interventionType",p.priority,p.status,p.responsible_department AS "responsibleDepartment",
   p.funding_source AS "fundingSource",p.estimated_cost::float8 AS "estimatedCost",p.contracted_cost::float8 AS "contractedCost",
   p.starts_at AS "startsAt",p.expected_end_at AS "expectedEndAt",p.completed_at AS "completedAt",p.residual_risk AS "residualRisk",p.notes,
   a.code AS "riskAreaCode",a.name AS "riskAreaName",p.created_at AS "createdAt"
   FROM mitigation_projects p LEFT JOIN territorial_risk_areas a ON a.id=p.risk_area_id WHERE p.organization_id=$1 ORDER BY CASE p.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,p.updated_at DESC`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/mitigation-projects",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=mitigationInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO mitigation_projects(organization_id,risk_area_id,code,title,intervention_type,priority,responsible_department,funding_source,estimated_cost,contracted_cost,starts_at,expected_end_at,residual_risk,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
   [o,v.riskAreaId||null,v.code,v.title,v.interventionType,v.priority,v.responsibleDepartment||null,v.fundingSource||null,v.estimatedCost??null,v.contractedCost??null,v.startsAt??null,v.expectedEndAt??null,v.residualRisk||null,v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/mitigation-projects/:id/status",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=statusOnly.safeParse(request.body);
  const allowed=["PLANNED","DESIGN","PROCUREMENT","EXECUTION","SUSPENDED","COMPLETED","CANCELLED"];
  if(!uuid.safeParse(id).success||!p.success||!allowed.includes(p.data.status))return reply.code(400).send({error:"INVALID_INPUT"});
  const r=await db.query(`UPDATE mitigation_projects SET status=$3,completed_at=CASE WHEN $3='COMPLETED' THEN current_date ELSE completed_at END,updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,status`,[id,o,p.data.status]);if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/community-nuclei",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,code,name,neighborhood,coordinator_name AS "coordinatorName",phone,email,members_count AS "membersCount",
   risk_area_ids AS "riskAreaIds",safe_points AS "safePoints",last_meeting_at AS "lastMeetingAt",last_training_at AS "lastTrainingAt",active,notes,created_at AS "createdAt"
   FROM community_nuclei WHERE organization_id=$1 ORDER BY active DESC,neighborhood,name`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/community-nuclei",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=nucleoInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO community_nuclei(organization_id,code,name,neighborhood,coordinator_name,phone,email,members_count,risk_area_ids,safe_points,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12) RETURNING id`,
   [o,v.code,v.name,v.neighborhood||null,v.coordinatorName||null,v.phone||null,v.email||null,v.membersCount,JSON.stringify(v.riskAreaIds),JSON.stringify(v.safePoints),v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/warning-assets",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,code,name,asset_type AS "assetType",status,address_line AS "addressLine",neighborhood,latitude,longitude,
   battery_percent::float8 AS "batteryPercent",responsible_name AS "responsibleName",responsible_phone AS "responsiblePhone",
   last_tested_at AS "lastTestedAt",next_test_at AS "nextTestAt",notes,created_at AS "createdAt"
   FROM warning_assets WHERE organization_id=$1 ORDER BY code`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/warning-assets",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=warningAssetInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO warning_assets(organization_id,code,name,asset_type,address_line,neighborhood,latitude,longitude,battery_percent,responsible_name,responsible_phone,next_test_at,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
   [o,v.code,v.name,v.assetType,v.addressLine||null,v.neighborhood||null,v.latitude??null,v.longitude??null,v.batteryPercent??null,v.responsibleName||null,v.responsiblePhone||null,v.nextTestAt??null,v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.post("/api/v1/warning-assets/:id/test",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query("UPDATE warning_assets SET last_tested_at=now(),status='OPERATIONAL',updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,last_tested_at AS \"lastTestedAt\"",[id,o]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/warnings",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT w.id,w.severity,w.title,w.message,w.instruction,w.cap_identifier AS "capIdentifier",w.channels,
   w.status,w.published_at AS "publishedAt",w.ended_at AS "endedAt",w.created_at AS "createdAt",i.protocol,a.code AS "riskAreaCode"
   FROM warning_activations w LEFT JOIN incidents i ON i.id=w.incident_id LEFT JOIN territorial_risk_areas a ON a.id=w.risk_area_id
   WHERE w.organization_id=$1 ORDER BY w.created_at DESC LIMIT 300`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/warnings",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=warningActivationInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO warning_activations(organization_id,incident_id,risk_area_id,severity,title,message,instruction,cap_identifier,channels,target_area_geojson,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) RETURNING id,status`,
   [o,v.incidentId||null,v.riskAreaId||null,v.severity,v.title,v.message,v.instruction||null,v.capIdentifier||null,JSON.stringify(v.channels),v.targetAreaGeojson?JSON.stringify(v.targetAreaGeojson):null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/warnings/:id/status",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=warningStatus.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT status FROM warning_activations WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!current.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const transitions:Record<string,string[]>={DRAFT:["PUBLISHED","CANCELLED"],PUBLISHED:["ENDED","CANCELLED"],ENDED:[],CANCELLED:[]};
  if(current.rows[0].status!==p.data.status&&!(transitions[current.rows[0].status]??[]).includes(p.data.status)){
   return reply.code(409).send({error:"INVALID_TRANSITION",message:`Transição de alerta ${current.rows[0].status} → ${p.data.status} não permitida.`});
  }
  const r=await db.query(`UPDATE warning_activations SET status=$3,published_at=CASE WHEN $3='PUBLISHED' THEN COALESCE(published_at,now()) ELSE published_at END,
   ended_at=CASE WHEN $3 IN('ENDED','CANCELLED') THEN now() ELSE ended_at END,approved_by=CASE WHEN $3='PUBLISHED' THEN $4 ELSE approved_by END,updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,status,published_at AS "publishedAt",ended_at AS "endedAt"`,[id,o,p.data.status,a.userId]);
  return r.rows[0];
 });

 app.get("/api/v1/evacuation-routes",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT e.id,e.code,e.name,e.origin_text AS "originText",e.destination_text AS "destinationText",e.distance_meters AS "distanceMeters",
   e.accessible,e.status,e.route_geojson AS "routeGeojson",e.notes,a.code AS "riskAreaCode",a.name AS "riskAreaName"
   FROM evacuation_routes e LEFT JOIN territorial_risk_areas a ON a.id=e.risk_area_id WHERE e.organization_id=$1 ORDER BY e.code`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/evacuation-routes",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=evacuationInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO evacuation_routes(organization_id,risk_area_id,code,name,origin_text,destination_text,distance_meters,accessible,route_geojson,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING id`,
   [o,v.riskAreaId||null,v.code,v.name,v.originText||null,v.destinationText,v.distanceMeters??null,v.accessible,v.routeGeojson?JSON.stringify(v.routeGeojson):null,v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/public-bulletins",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT b.id,b.title,b.content,b.audience,b.channels,b.status,b.published_at AS "publishedAt",b.expires_at AS "expiresAt",
   b.created_at AS "createdAt",i.protocol FROM public_bulletins b LEFT JOIN incidents i ON i.id=b.incident_id WHERE b.organization_id=$1 ORDER BY b.created_at DESC LIMIT 300`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/public-bulletins",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=bulletinInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO public_bulletins(organization_id,incident_id,warning_activation_id,title,content,audience,channels,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id,status`,[o,v.incidentId||null,v.warningActivationId||null,v.title,v.content,v.audience||null,JSON.stringify(v.channels),a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/public-bulletins/:id/status",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=bulletinStatus.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT status FROM public_bulletins WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!current.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const transitions:Record<string,string[]>={DRAFT:["APPROVED","CANCELLED"],APPROVED:["PUBLISHED","CANCELLED"],PUBLISHED:["EXPIRED","CANCELLED"],EXPIRED:[],CANCELLED:[]};
  if(current.rows[0].status!==p.data.status&&!(transitions[current.rows[0].status]??[]).includes(p.data.status)){
   return reply.code(409).send({error:"INVALID_TRANSITION",message:`Transição de boletim ${current.rows[0].status} → ${p.data.status} não permitida.`});
  }
  const r=await db.query(`UPDATE public_bulletins SET status=$3,approved_by=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by END,
   published_at=CASE WHEN $3='PUBLISHED' THEN COALESCE(published_at,now()) ELSE published_at END,expires_at=COALESCE($5,expires_at),updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,status,published_at AS "publishedAt"`,[id,o,p.data.status,a.userId,p.data.expiresAt??null]);
  return r.rows[0];
 });

 app.get("/api/v1/damage-assessments",{preHandler:requirePermission("damages.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT d.*,d.assessment_type AS "assessmentType",d.affected_people AS "affectedPeople",d.displaced_people AS "displacedPeople",
   d.homeless_people AS "homelessPeople",d.injured_people AS "injuredPeople",d.missing_people AS "missingPeople",d.houses_damaged AS "housesDamaged",
   d.houses_destroyed AS "housesDestroyed",d.public_damage::float8 AS "publicDamage",d.private_damage::float8 AS "privateDamage",
   d.public_loss::float8 AS "publicLoss",d.private_loss::float8 AS "privateLoss",d.environmental_damage AS "environmentalDamage",
   d.assessed_at AS "assessedAt",i.protocol,i.summary AS "incidentSummary"
   FROM damage_assessments d JOIN incidents i ON i.id=d.incident_id WHERE d.organization_id=$1 ORDER BY d.assessed_at DESC LIMIT 300`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/damage-assessments",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=damageInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO damage_assessments(organization_id,incident_id,assessment_type,affected_people,displaced_people,homeless_people,injured_people,deaths,missing_people,houses_damaged,houses_destroyed,public_damage,private_damage,environmental_damage,public_loss,private_loss,summary,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id,status`,
   [o,v.incidentId,v.assessmentType,v.affectedPeople,v.displacedPeople,v.homelessPeople,v.injuredPeople,v.deaths,v.missingPeople,v.housesDamaged,v.housesDestroyed,v.publicDamage,v.privateDamage,v.environmentalDamage||null,v.publicLoss,v.privateLoss,v.summary||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.get("/api/v1/damage-assessments/:id/items",{preHandler:requirePermission("damages.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query(`SELECT id,category,description,quantity::float8,unit,estimated_value::float8 AS "estimatedValue",latitude,longitude,incident_attachment_id AS "incidentAttachmentId",created_at AS "createdAt"
   FROM damage_items WHERE assessment_id=$1 AND organization_id=$2 ORDER BY created_at`,[id,o]);return {items:r.rows};
 });
 app.post("/api/v1/damage-assessments/:id/items",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=damageItemInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const parent=await db.query("SELECT 1 FROM damage_assessments WHERE id=$1 AND organization_id=$2",[id,o]);if(!parent.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data,r=await db.query(`INSERT INTO damage_items(organization_id,assessment_id,category,description,quantity,unit,estimated_value,latitude,longitude,incident_attachment_id,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
   [o,id,v.category,v.description,v.quantity??null,v.unit||null,v.estimatedValue??null,v.latitude??null,v.longitude??null,v.incidentAttachmentId||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/damage-assessments/:id/validate",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query("UPDATE damage_assessments SET status='VALIDATED',validated_by=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='DRAFT' RETURNING id,status",[id,o,a.userId]);
  if(!r.rows[0]){const exists=await db.query("SELECT 1 FROM damage_assessments WHERE id=$1 AND organization_id=$2",[id,o]);return exists.rows[0]?reply.code(409).send({error:"ALREADY_VALIDATED"}):reply.code(404).send({error:"NOT_FOUND"});}return r.rows[0];
 });

 app.get("/api/v1/critical-infrastructures",{preHandler:requirePermission("infrastructure.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,code,name,category,owner_name AS "ownerName",responsible_name AS "responsibleName",responsible_phone AS "responsiblePhone",
   address_line AS "addressLine",neighborhood,latitude,longitude,operational_status AS "operationalStatus",criticality,redundancy,backup_power AS "backupPower",
   autonomy_hours::float8 AS "autonomyHours",notes,updated_at AS "updatedAt" FROM critical_infrastructures WHERE organization_id=$1 ORDER BY CASE criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,code`,[o]);
  return {items:r.rows};
 });
 app.post("/api/v1/critical-infrastructures",{preHandler:requirePermission("infrastructure.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=infrastructureInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO critical_infrastructures(organization_id,code,name,category,owner_name,responsible_name,responsible_phone,address_line,neighborhood,latitude,longitude,criticality,redundancy,backup_power,autonomy_hours,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
   [o,v.code,v.name,v.category,v.ownerName||null,v.responsibleName||null,v.responsiblePhone||null,v.addressLine||null,v.neighborhood||null,v.latitude??null,v.longitude??null,v.criticality,v.redundancy||null,v.backupPower,v.autonomyHours??null,v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.post("/api/v1/critical-infrastructures/:id/events",{preHandler:requirePermission("infrastructure.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=infrastructureEvent.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const exists=await db.query("SELECT 1 FROM critical_infrastructures WHERE id=$1 AND organization_id=$2",[id,o]);if(!exists.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;await db.query("BEGIN");try{
   const r=await db.query(`INSERT INTO critical_infrastructure_events(organization_id,infrastructure_id,incident_id,status,impact,estimated_restore_at,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[o,id,v.incidentId||null,v.status,v.impact||null,v.estimatedRestoreAt??null,v.notes||null,a.userId]);
   const mapped=v.status==="RESTORED"?"OPERATIONAL":v.status;
   await db.query("UPDATE critical_infrastructures SET operational_status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,mapped]);
   await db.query("COMMIT");return reply.code(201).send(r.rows[0]);
  }catch(e){await db.query("ROLLBACK");throw e}
 });

 app.get("/api/v1/animal-rescues",{preHandler:requirePermission("animals.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT a.id,a.species,a.quantity,a.animal_name AS "animalName",a.identification,a.tutor_name AS "tutorName",a.tutor_phone AS "tutorPhone",
   a.found_location AS "foundLocation",a.latitude,a.longitude,a.destination,a.health_status AS "healthStatus",a.veterinary_notes AS "veterinaryNotes",
   a.microchip,a.vaccination_status AS "vaccinationStatus",a.status,a.returned_at AS "returnedAt",a.created_at AS "createdAt",i.protocol,s.name AS "shelterName"
   FROM animal_rescues a LEFT JOIN incidents i ON i.id=a.incident_id LEFT JOIN shelters s ON s.id=a.shelter_id
   WHERE a.organization_id=$1 ORDER BY a.created_at DESC`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/animal-rescues",{preHandler:requirePermission("animals.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=animalInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO animal_rescues(organization_id,incident_id,shelter_id,species,quantity,animal_name,identification,tutor_name,tutor_phone,found_location,latitude,longitude,destination,health_status,veterinary_notes,microchip,vaccination_status,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id,status`,
   [o,v.incidentId||null,v.shelterId||null,v.species,v.quantity,v.animalName||null,v.identification||null,v.tutorName||null,v.tutorPhone||null,v.foundLocation||null,v.latitude??null,v.longitude??null,v.destination||null,v.healthStatus,v.veterinaryNotes||null,v.microchip||null,v.vaccinationStatus||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/animal-rescues/:id/status",{preHandler:requirePermission("animals.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=animalStatus.safeParse(request.body);if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT status FROM animal_rescues WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!current.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const transitions:Record<string,string[]>={RESCUED:["SHELTERED","VETERINARY","RETURNED","TRANSFERRED","DECEASED"],SHELTERED:["VETERINARY","RETURNED","TRANSFERRED","DECEASED"],VETERINARY:["SHELTERED","RETURNED","TRANSFERRED","DECEASED"],RETURNED:[],TRANSFERRED:[],DECEASED:[]};
  if(current.rows[0].status!==p.data.status&&!(transitions[current.rows[0].status]??[]).includes(p.data.status)){
   return reply.code(409).send({error:"INVALID_TRANSITION",message:`Transição de resgate animal ${current.rows[0].status} → ${p.data.status} não permitida.`});
  }
  const r=await db.query(`UPDATE animal_rescues SET status=$3,destination=COALESCE($4,destination),returned_at=CASE WHEN $3='RETURNED' THEN COALESCE(returned_at,now()) ELSE returned_at END,updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,status,returned_at AS "returnedAt"`,[id,o,p.data.status,p.data.destination??null]);
  return r.rows[0];
 });

 app.get("/api/v1/disaster-costs",{preHandler:requirePermission("damages.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT c.id,c.category,c.description,c.supplier,c.document_reference AS "documentReference",c.quantity::float8,c.unit,c.amount::float8,
   c.funding_source AS "fundingSource",c.occurred_at AS "occurredAt",i.protocol FROM disaster_cost_entries c LEFT JOIN incidents i ON i.id=c.incident_id
   WHERE c.organization_id=$1 ORDER BY c.occurred_at DESC LIMIT 500`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/disaster-costs",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=costInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO disaster_cost_entries(organization_id,incident_id,category,description,supplier,document_reference,quantity,unit,amount,funding_source,occurred_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
   [o,v.incidentId||null,v.category,v.description,v.supplier||null,v.documentReference||null,v.quantity??null,v.unit||null,v.amount,v.fundingSource||null,v.occurredAt??new Date(),a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/incident-lessons",{preHandler:requirePermission("damages.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT l.id,l.category,l.title,l.observation,l.corrective_action AS "correctiveAction",l.responsible_name AS "responsibleName",
   l.due_at AS "dueAt",l.status,l.effectiveness_notes AS "effectivenessNotes",l.created_at AS "createdAt",i.protocol,e.name AS "operationName"
   FROM incident_lessons l LEFT JOIN incidents i ON i.id=l.incident_id LEFT JOIN emergency_operations e ON e.id=l.operation_id
   WHERE l.organization_id=$1 ORDER BY CASE l.status WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 ELSE 3 END,l.created_at DESC`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/incident-lessons",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=lessonInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO incident_lessons(organization_id,incident_id,operation_id,category,title,observation,corrective_action,responsible_name,due_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status`,
   [o,v.incidentId||null,v.operationId||null,v.category,v.title,v.observation,v.correctiveAction||null,v.responsibleName||null,v.dueAt??null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/incident-lessons/:id/status",{preHandler:requirePermission("damages.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=lessonStatus.safeParse(request.body);if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT status FROM incident_lessons WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!current.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const transitions:Record<string,string[]>={OPEN:["IN_PROGRESS"],IN_PROGRESS:["VERIFIED"],VERIFIED:["CLOSED","IN_PROGRESS"],CLOSED:[]};
  if(current.rows[0].status!==p.data.status&&!(transitions[current.rows[0].status]??[]).includes(p.data.status)){
   return reply.code(409).send({error:"INVALID_TRANSITION",message:`Transição de lição aprendida ${current.rows[0].status} → ${p.data.status} não permitida.`});
  }
  const r=await db.query("UPDATE incident_lessons SET status=$3,effectiveness_notes=$4,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status",[id,o,p.data.status,p.data.effectivenessNotes||null]);
  return r.rows[0];
 });

 app.get("/api/v1/resource-readiness",{preHandler:requirePermission("infrastructure.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,resource_type AS "resourceType",resource_id AS "resourceId",code,name,readiness_status AS "readinessStatus",
   next_maintenance_at AS "nextMaintenanceAt",calibration_due_at AS "calibrationDueAt",fuel_level_percent::float8 AS "fuelLevelPercent",
   battery_percent::float8 AS "batteryPercent",location_text AS "locationText",notes,updated_at AS "updatedAt"
   FROM resource_readiness WHERE organization_id=$1 ORDER BY CASE readiness_status WHEN 'UNAVAILABLE' THEN 1 WHEN 'MAINTENANCE' THEN 2 WHEN 'RESTRICTED' THEN 3 ELSE 4 END,code`,[o]);return {items:r.rows};
 });
 app.post("/api/v1/resource-readiness",{preHandler:requirePermission("infrastructure.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=readinessInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,r=await db.query(`INSERT INTO resource_readiness(organization_id,resource_type,resource_id,code,name,readiness_status,next_maintenance_at,calibration_due_at,fuel_level_percent,battery_percent,location_text,notes,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
   ON CONFLICT(organization_id,resource_type,code) DO UPDATE SET resource_id=EXCLUDED.resource_id,name=EXCLUDED.name,readiness_status=EXCLUDED.readiness_status,
   next_maintenance_at=EXCLUDED.next_maintenance_at,calibration_due_at=EXCLUDED.calibration_due_at,fuel_level_percent=EXCLUDED.fuel_level_percent,
   battery_percent=EXCLUDED.battery_percent,location_text=EXCLUDED.location_text,notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=now()
   RETURNING id`,[o,v.resourceType,v.resourceId||null,v.code,v.name,v.readinessStatus,v.nextMaintenanceAt??null,v.calibrationDueAt??null,v.fuelLevelPercent??null,v.batteryPercent??null,v.locationText||null,v.notes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/sco/operations/:id/action-plan",{preHandler:requirePermission("sco.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const op=await db.query("SELECT 1 FROM emergency_operations WHERE id=$1 AND organization_id=$2",[id,o]);if(!op.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT a.id,a.period_id AS "periodId",p.sequence_no AS "periodSequence",a.item_type AS "itemType",a.title,a.detail,a.due_at AS "dueAt",a.status,
   t.code AS "teamCode",u.display_name AS "assignedUserName",u.matricula AS "assignedUserMatricula",a.created_at AS "createdAt"
   FROM sco_action_plan_items a LEFT JOIN operational_periods p ON p.id=a.period_id LEFT JOIN teams t ON t.id=a.assigned_team_id LEFT JOIN users u ON u.id=a.assigned_user_id
   WHERE a.operation_id=$1 AND a.organization_id=$2 ORDER BY COALESCE(p.sequence_no,999999),a.item_type,a.created_at`,[id,o]);return {items:r.rows};
 });
 app.post("/api/v1/sco/operations/:id/action-plan",{preHandler:requirePermission("sco.action_plan.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=actionPlanItem.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const op=await db.query("SELECT 1 FROM emergency_operations WHERE id=$1 AND organization_id=$2",[id,o]);if(!op.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data,r=await db.query(`INSERT INTO sco_action_plan_items(organization_id,operation_id,period_id,item_type,title,detail,assigned_team_id,assigned_user_id,due_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status`,
   [o,id,v.periodId||null,v.itemType,v.title,v.detail||null,v.assignedTeamId||null,v.assignedUserId||null,v.dueAt??null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });
 app.patch("/api/v1/sco/action-plan/:itemId/status",{preHandler:requirePermission("sco.action_plan.manage")},async(request,reply)=>{
  const o=org(request),{itemId}=request.params as {itemId:string},p=actionPlanStatus.safeParse(request.body);if(!uuid.safeParse(itemId).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const r=await db.query("UPDATE sco_action_plan_items SET status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status",[itemId,o,p.data.status]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/shelters/readiness",{preHandler:requirePermission("risk_management.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT s.id,s.name,s.address_line AS "addressLine",s.neighborhood,s.capacity_people AS "capacityPeople",s.status,
   s.responsible_name AS "responsibleName",s.contact_phone AS "contactPhone",s.accessible,s.kitchen_available AS "kitchenAvailable",
   s.generator_available AS "generatorAvailable",s.pet_area_available AS "petAreaAvailable",s.latitude,s.longitude,
   s.readiness_notes AS "readinessNotes",s.last_readiness_check_at AS "lastReadinessCheckAt",
   COALESCE(h.people,0)::int AS "currentPeople"
   FROM shelters s LEFT JOIN LATERAL(
    SELECT COALESCE(sum(adults+children+elderly+persons_with_disability),0) AS people
    FROM assisted_households h WHERE h.shelter_id=s.id AND h.departed_at IS NULL
   ) h ON true WHERE s.organization_id=$1 ORDER BY s.name`,[o]);return {items:r.rows};
 });
 app.put("/api/v1/shelters/:id/readiness",{preHandler:requirePermission("risk_management.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=shelterReadiness.safeParse(request.body);if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const v=p.data,r=await db.query(`UPDATE shelters SET responsible_name=$3,contact_phone=$4,accessible=$5,kitchen_available=$6,generator_available=$7,
   pet_area_available=$8,latitude=$9,longitude=$10,readiness_notes=$11,last_readiness_check_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,last_readiness_check_at AS "lastReadinessCheckAt"`,
   [id,o,v.responsibleName||null,v.contactPhone||null,v.accessible,v.kitchenAvailable,v.generatorAvailable,v.petAreaAvailable,v.latitude??null,v.longitude??null,v.readinessNotes||null]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });
 app.get("/api/v1/warnings/:id/cap",{preHandler:requirePermission("risk_management.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query(`SELECT w.id,w.severity,w.title,w.message,w.instruction,w.cap_identifier,w.status,w.created_at,w.published_at,w.ended_at,
   w.channels,a.code AS risk_area_code,a.name AS risk_area_name,a.neighborhood
   FROM warning_activations w LEFT JOIN territorial_risk_areas a ON a.id=w.risk_area_id WHERE w.id=$1 AND w.organization_id=$2`,[id,o]);
  const w=r.rows[0];if(!w)return reply.code(404).send({error:"NOT_FOUND"});
  const identifier=w.cap_identifier||("SIGDEC-UBATUBA-"+w.id);
  const severity=w.severity==="EMERGENCY"?"Extreme":w.severity==="WARNING"?"Severe":w.severity==="WATCH"?"Moderate":"Minor";
  const sent=new Date(w.published_at??w.created_at).toISOString();
  const msgType=w.status==="ENDED"||w.status==="CANCELLED"?"Cancel":"Alert";
  const area=[w.risk_area_code,w.risk_area_name,w.neighborhood].filter(Boolean).join(" · ")||"Município de Ubatuba/SP";
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+
   '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">'+
   '<identifier>'+xmlEscape(identifier)+'</identifier><sender>SIGDEC-Ubatuba</sender><sent>'+xmlEscape(sent)+'</sent>'+
   '<status>Actual</status><msgType>'+msgType+'</msgType><scope>Public</scope><info><category>Safety</category>'+
   '<event>'+xmlEscape(w.title)+'</event><urgency>Immediate</urgency><severity>'+severity+'</severity><certainty>Observed</certainty>'+
   '<headline>'+xmlEscape(w.title)+'</headline><description>'+xmlEscape(w.message)+'</description>'+
   (w.instruction?'<instruction>'+xmlEscape(w.instruction)+'</instruction>':'')+
   '<area><areaDesc>'+xmlEscape(area)+'</areaDesc></area></info></alert>';
  return reply.type("application/xml; charset=utf-8").header("Content-Disposition",'attachment; filename="alerta-'+id+'.xml"').send(xml);
 });

 app.get("/api/v1/damage-assessments/:id/export",{preHandler:requirePermission("damages.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const [assessment,items]=await Promise.all([
   db.query(`SELECT d.*,i.protocol,i.summary AS incident_summary,i.description AS incident_description,i.address_line,i.neighborhood,i.created_at AS incident_created_at
    FROM damage_assessments d JOIN incidents i ON i.id=d.incident_id WHERE d.id=$1 AND d.organization_id=$2`,[id,o]),
   db.query(`SELECT category,description,quantity::float8,unit,estimated_value::float8 AS estimated_value,latitude,longitude,incident_attachment_id
    FROM damage_items WHERE assessment_id=$1 AND organization_id=$2 ORDER BY created_at`,[id,o])
  ]);
  const a=assessment.rows[0];if(!a)return reply.code(404).send({error:"NOT_FOUND"});
  const payload={
   exportVersion:"SIGDEC-DAMAGE-1.0",generatedAt:new Date().toISOString(),
   incident:{protocol:a.protocol,summary:a.incident_summary,description:a.incident_description,addressLine:a.address_line,neighborhood:a.neighborhood,createdAt:a.incident_created_at},
   assessment:{id:a.id,type:a.assessment_type,status:a.status,assessedAt:a.assessed_at,
    humanDamage:{affected:a.affected_people,displaced:a.displaced_people,homeless:a.homeless_people,injured:a.injured_people,deaths:a.deaths,missing:a.missing_people},
    housingDamage:{damaged:a.houses_damaged,destroyed:a.houses_destroyed},
    economic:{publicDamage:Number(a.public_damage),privateDamage:Number(a.private_damage),publicLoss:Number(a.public_loss),privateLoss:Number(a.private_loss)},
    environmentalDamage:a.environmental_damage,summary:a.summary},
   items:items.rows,
   s2idDraft:{fide:a.assessment_type==="FIDE"||a.assessment_type==="FINAL",dmate:a.assessment_type==="DMATE"||a.assessment_type==="FINAL",requiresOfficialReview:true}
  };
  return reply.type("application/json; charset=utf-8").header("Content-Disposition",'attachment; filename="'+a.protocol+'-'+a.assessment_type+'.json"').send(payload);
 });

}
