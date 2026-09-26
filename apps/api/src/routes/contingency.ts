import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";

const uuid=z.string().uuid();
const levels=["NORMAL","OBSERVATION","ATTENTION","ALERT","EMERGENCY"] as const;
const planStatuses=["DRAFT","APPROVED","ACTIVE","ARCHIVED"] as const;
const anomalyStatuses=["DRAFT","DOCUMENTING","SUBMITTED","UNDER_REVIEW","RECOGNIZED","REJECTED","CLOSED"] as const;

const planInput=z.object({
 code:z.string().trim().min(2).max(60),
 title:z.string().trim().min(3).max(240),
 cobradeCode:z.string().trim().max(30).optional().default(""),
 scope:z.string().trim().max(5000).optional().default(""),
 objective:z.string().trim().max(5000).optional().default(""),
 triggerCriteria:z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
 callPlan:z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
 resources:z.array(z.string().trim().min(1).max(1000)).max(200).default([]),
 sheltersRoutes:z.array(z.string().trim().min(1).max(1000)).max(200).default([]),
 procedures:z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
 notes:z.string().trim().max(8000).optional().default("")
});
const planStatusInput=z.object({status:z.enum(planStatuses)});
const activationInput=z.object({level:z.enum(levels),reason:z.string().trim().min(3).max(4000)});
const anomalyInput=z.object({
 incidentProtocol:z.string().trim().max(80).optional().default(""),
 cobradeCode:z.string().trim().min(3).max(30),
 situationType:z.enum(["SE","ECP"]),
 summary:z.string().trim().min(5).max(5000),
 decreeNumber:z.string().trim().max(80).optional().default(""),
 decreeDate:z.string().trim().max(20).optional().default(""),
 externalProtocol:z.string().trim().max(200).optional().default(""),
 deadlineAt:z.coerce.date().optional(),
 notes:z.string().trim().max(8000).optional().default("")
});
const anomalyUpdate=z.object({
 status:z.enum(anomalyStatuses),
 decreeNumber:z.string().trim().max(80).nullable().optional(),
 decreeDate:z.string().trim().max(20).nullable().optional(),
 externalProtocol:z.string().trim().max(200).nullable().optional(),
 deadlineAt:z.coerce.date().nullable().optional(),
 notes:z.string().trim().max(8000).nullable().optional()
});
const fvdInput=z.object({
 code:z.string().trim().min(1).max(80),
 requirementType:z.enum(["FIDE","DMATE","PHOTO_REPORT","DECREE","TECHNICAL_REPORT","OTHER"]).default("OTHER"),
 title:z.string().trim().min(3).max(500),
 dueAt:z.coerce.date().optional(),
 responseNotes:z.string().trim().max(8000).optional().default("")
});
const fvdUpdate=z.object({
 status:z.enum(["PENDING","RESPONDED","ACCEPTED","REJECTED"]),
 dueAt:z.coerce.date().nullable().optional(),
 responseNotes:z.string().trim().max(8000).nullable().optional()
});

function organization(request:FastifyRequest){
 const value=authFrom(request).organizationId;
 if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});
 return value;
}

async function actorMatricula(request:FastifyRequest){
 const auth=authFrom(request),org=organization(request);
 const result=await db.query("SELECT matricula FROM users WHERE id=$1 AND organization_id=$2",[auth.userId,org]);
 if(!result.rows[0])throw Object.assign(new Error("Servidor não localizado."),{statusCode:409});
 return String(result.rows[0].matricula);
}

function dateOrNull(value:string|null|undefined){
 if(!value)return null;
 return value;
}

export async function contingencyRoutes(app:FastifyInstance){
 app.get("/api/v1/planning/summary",{preHandler:requirePermission("plancon.manage")},async request=>{
  const org=organization(request);
  const result=await db.query(`SELECT
   (SELECT count(*) FROM contingency_plans WHERE organization_id=$1)::int AS "planCount",
   (SELECT count(*) FROM contingency_plans WHERE organization_id=$1 AND status='ACTIVE')::int AS "activePlans",
   (SELECT count(*) FROM abnormal_situation_cases WHERE organization_id=$1 AND status NOT IN ('CLOSED','RECOGNIZED','REJECTED'))::int AS "openAnomalyCases",
   (SELECT count(*) FROM abnormal_fvd_items WHERE organization_id=$1 AND status IN ('PENDING','REJECTED'))::int AS "pendingFvd",
   (SELECT count(*) FROM contingency_plan_activations WHERE organization_id=$1 AND occurred_at>=now()-interval '24 hours')::int AS "activations24h"`,[org]);
  return result.rows[0];
 });

 app.get("/api/v1/plancon",{preHandler:requirePermission("plancon.manage")},async request=>{
  const org=organization(request);
  const result=await db.query(`SELECT p.id,p.code,p.version,p.title,p.cobrade_code AS "cobradeCode",p.scope,p.objective,
    p.status,p.current_level AS "currentLevel",p.trigger_criteria AS "triggerCriteria",p.call_plan AS "callPlan",
    p.resources,p.shelters_routes AS "sheltersRoutes",p.procedures,p.notes,p.created_at AS "createdAt",
    p.updated_at AS "updatedAt",p.approved_at AS "approvedAt",
    c.matricula AS "createdByMatricula",c.display_name AS "createdByName",
    a.matricula AS "approvedByMatricula",a.display_name AS "approvedByName",
    (SELECT count(*)::int FROM contingency_plan_activations x WHERE x.plan_id=p.id) AS "activationCount"
    FROM contingency_plans p
    JOIN users c ON c.id=p.created_by
    LEFT JOIN users a ON a.id=p.approved_by
    WHERE p.organization_id=$1
    ORDER BY p.code,p.version DESC,p.updated_at DESC`,[org]);
  return {items:result.rows};
 });

 app.post("/api/v1/plancon",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),parsed=planInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data;
  const versionResult=await db.query("SELECT COALESCE(max(version),0)::int+1 AS version FROM contingency_plans WHERE organization_id=$1 AND code=$2",[org,v.code]);
  const version=Number(versionResult.rows[0]?.version??1);
  const result=await db.query(`INSERT INTO contingency_plans(
    organization_id,code,version,title,cobrade_code,scope,objective,trigger_criteria,call_plan,resources,shelters_routes,procedures,notes,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)
   RETURNING id,code,version,status,current_level AS "currentLevel",created_at AS "createdAt"`,[
    org,v.code,version,v.title,v.cobradeCode||null,v.scope||null,v.objective||null,JSON.stringify(v.triggerCriteria),
    JSON.stringify(v.callPlan),JSON.stringify(v.resources),JSON.stringify(v.sheltersRoutes),JSON.stringify(v.procedures),v.notes||null,auth.userId
   ]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/revision",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const source=await db.query("SELECT * FROM contingency_plans WHERE id=$1 AND organization_id=$2",[id,org]);
  const p=source.rows[0];if(!p)return reply.code(404).send({error:"NOT_FOUND"});
  const next=await db.query("SELECT COALESCE(max(version),0)::int+1 AS version FROM contingency_plans WHERE organization_id=$1 AND code=$2",[org,p.code]);
  const version=Number(next.rows[0]?.version??Number(p.version)+1);
  const result=await db.query(`INSERT INTO contingency_plans(
    organization_id,code,version,title,cobrade_code,scope,objective,trigger_criteria,call_plan,resources,shelters_routes,procedures,notes,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   RETURNING id,code,version,status,current_level AS "currentLevel",created_at AS "createdAt"`,[
    org,p.code,version,p.title,p.cobrade_code,p.scope,p.objective,p.trigger_criteria,p.call_plan,p.resources,p.shelters_routes,p.procedures,p.notes,auth.userId
   ]);
  return reply.code(201).send(result.rows[0]);
 });

 app.patch("/api/v1/plancon/:id/status",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=planStatusInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT id,status FROM contingency_plans WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!current.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const allowed:Record<string,string[]>={DRAFT:["APPROVED","ARCHIVED"],APPROVED:["ACTIVE","ARCHIVED"],ACTIVE:["APPROVED","ARCHIVED"],ARCHIVED:[]};
  const next=parsed.data.status;
  if(current.rows[0].status!==next&&!allowed[current.rows[0].status]?.includes(next))return reply.code(409).send({error:"INVALID_TRANSITION"});
  const result=await db.query(`UPDATE contingency_plans SET status=$3,
    approved_by=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by END,
    approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,
    updated_at=now()
    WHERE id=$1 AND organization_id=$2
    RETURNING id,status,current_level AS "currentLevel",approved_at AS "approvedAt"`,[id,org,next,auth.userId]);
  return result.rows[0];
 });

 app.post("/api/v1/plancon/:id/activation",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=activationInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const plan=await db.query("SELECT id,status,current_level FROM contingency_plans WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!plan.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  if(!["APPROVED","ACTIVE"].includes(plan.rows[0].status))return reply.code(409).send({error:"PLAN_NOT_APPROVED"});
  const matricula=await actorMatricula(request),client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query(`INSERT INTO contingency_plan_activations(
     organization_id,plan_id,from_level,to_level,reason,actor_user_id,actor_matricula
    ) VALUES($1,$2,$3,$4,$5,$6,$7)`,[org,id,plan.rows[0].current_level,parsed.data.level,parsed.data.reason,auth.userId,matricula]);
   const result=await client.query(`UPDATE contingency_plans SET current_level=$3,
     status=CASE WHEN $3<>'NORMAL' THEN 'ACTIVE' ELSE status END,updated_at=now()
     WHERE id=$1 AND organization_id=$2
     RETURNING id,status,current_level AS "currentLevel",updated_at AS "updatedAt"`,[id,org,parsed.data.level]);
   await client.query("COMMIT");return result.rows[0];
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
 });

 app.get("/api/v1/plancon/:id/activations",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const org=organization(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const result=await db.query(`SELECT x.id::text AS id,x.from_level AS "fromLevel",x.to_level AS "toLevel",x.reason,
    x.actor_matricula AS "actorMatricula",u.display_name AS "actorName",x.occurred_at AS "occurredAt"
    FROM contingency_plan_activations x JOIN users u ON u.id=x.actor_user_id
    WHERE x.organization_id=$1 AND x.plan_id=$2 ORDER BY x.occurred_at DESC,x.id DESC LIMIT 200`,[org,id]);
  return {items:result.rows};
 });

 app.get("/api/v1/anomaly-cases",{preHandler:requirePermission("anomaly.manage")},async request=>{
  const org=organization(request);
  const result=await db.query(`SELECT c.id,c.cobrade_code AS "cobradeCode",c.situation_type AS "situationType",c.status,c.summary,
    c.decree_number AS "decreeNumber",c.decree_date AS "decreeDate",c.external_protocol AS "externalProtocol",
    c.deadline_at AS "deadlineAt",c.notes,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
    i.protocol AS "incidentProtocol",u.matricula AS "createdByMatricula",u.display_name AS "createdByName",
    count(f.id)::int AS "fvdCount",
    count(f.id) FILTER(WHERE f.status IN ('PENDING','REJECTED'))::int AS "pendingFvd"
    FROM abnormal_situation_cases c
    JOIN users u ON u.id=c.created_by
    LEFT JOIN incidents i ON i.id=c.incident_id
    LEFT JOIN abnormal_fvd_items f ON f.case_id=c.id
    WHERE c.organization_id=$1
    GROUP BY c.id,i.protocol,u.matricula,u.display_name
    ORDER BY c.updated_at DESC`,[org]);
  return {items:result.rows};
 });

 app.post("/api/v1/anomaly-cases",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),parsed=anomalyInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data;let incidentId:string|null=null;
  if(v.incidentProtocol){
   const incident=await db.query("SELECT id FROM incidents WHERE organization_id=$1 AND protocol=$2",[org,v.incidentProtocol]);
   if(!incident.rows[0])return reply.code(404).send({error:"INCIDENT_NOT_FOUND",message:"Protocolo de ocorrência não localizado."});
   incidentId=incident.rows[0].id;
  }
  const result=await db.query(`INSERT INTO abnormal_situation_cases(
    organization_id,incident_id,cobrade_code,situation_type,summary,decree_number,decree_date,external_protocol,deadline_at,notes,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   RETURNING id,status,created_at AS "createdAt"`,[
    org,incidentId,v.cobradeCode,v.situationType,v.summary,v.decreeNumber||null,dateOrNull(v.decreeDate),
    v.externalProtocol||null,v.deadlineAt??null,v.notes||null,auth.userId
   ]);
  return reply.code(201).send(result.rows[0]);
 });

 app.patch("/api/v1/anomaly-cases/:id",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const org=organization(request),{id}=request.params as {id:string},parsed=anomalyUpdate.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const exists=await db.query("SELECT id FROM abnormal_situation_cases WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!exists.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=parsed.data;
  const result=await db.query(`UPDATE abnormal_situation_cases SET status=$3,
    decree_number=COALESCE($4,decree_number),decree_date=COALESCE($5::date,decree_date),
    external_protocol=COALESCE($6,external_protocol),deadline_at=COALESCE($7,deadline_at),
    notes=COALESCE($8,notes),updated_at=now()
    WHERE id=$1 AND organization_id=$2
    RETURNING id,status,decree_number AS "decreeNumber",decree_date AS "decreeDate",
      external_protocol AS "externalProtocol",deadline_at AS "deadlineAt",updated_at AS "updatedAt"`,[
    id,org,v.status,v.decreeNumber??null,v.decreeDate??null,v.externalProtocol??null,v.deadlineAt??null,v.notes??null
   ]);
  return result.rows[0];
 });

 app.get("/api/v1/anomaly-cases/:id/fvd",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const org=organization(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const result=await db.query(`SELECT f.id,f.code,f.requirement_type AS "requirementType",f.title,f.status,
    f.due_at AS "dueAt",f.response_notes AS "responseNotes",f.created_at AS "createdAt",f.updated_at AS "updatedAt",
    c.matricula AS "createdByMatricula",c.display_name AS "createdByName",
    r.matricula AS "resolvedByMatricula",r.display_name AS "resolvedByName"
    FROM abnormal_fvd_items f JOIN users c ON c.id=f.created_by LEFT JOIN users r ON r.id=f.resolved_by
    WHERE f.organization_id=$1 AND f.case_id=$2 ORDER BY f.status,f.due_at NULLS LAST,f.created_at`,[org,id]);
  return {items:result.rows};
 });

 app.post("/api/v1/anomaly-cases/:id/fvd",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=fvdInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const parent=await db.query("SELECT id FROM abnormal_situation_cases WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!parent.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=parsed.data;
  try{
   const result=await db.query(`INSERT INTO abnormal_fvd_items(
     organization_id,case_id,code,requirement_type,title,due_at,response_notes,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id,status,created_at AS "createdAt"`,[org,id,v.code,v.requirementType,v.title,v.dueAt??null,v.responseNotes||null,auth.userId]);
   return reply.code(201).send(result.rows[0]);
  }catch(error:any){
   if(error?.code==="23505")return reply.code(409).send({error:"FVD_CODE_EXISTS",message:"Já existe uma pendência com este código no processo."});
   throw error;
  }
 });

 app.patch("/api/v1/anomaly-cases/:caseId/fvd/:itemId",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{caseId,itemId}=request.params as {caseId:string;itemId:string},parsed=fvdUpdate.safeParse(request.body);
  if(!uuid.safeParse(caseId).success||!uuid.safeParse(itemId).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=parsed.data;
  const result=await db.query(`UPDATE abnormal_fvd_items SET status=$4,due_at=COALESCE($5,due_at),
    response_notes=COALESCE($6,response_notes),resolved_by=CASE WHEN $4 IN ('ACCEPTED','REJECTED') THEN $7 ELSE resolved_by END,
    updated_at=now()
    WHERE id=$1 AND case_id=$2 AND organization_id=$3
    RETURNING id,status,due_at AS "dueAt",response_notes AS "responseNotes",updated_at AS "updatedAt"`,[
    itemId,caseId,org,v.status,v.dueAt??null,v.responseNotes??null,auth.userId
   ]);
  if(!result.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  return result.rows[0];
 });

 app.post("/api/v1/anomaly-cases/:id/s2id/:type",{preHandler:requirePermission("anomaly.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id,type}=request.params as {id:string;type:string};
  if(!uuid.safeParse(id).success||!["FIDE","DMATE"].includes(type))return reply.code(400).send({error:"INVALID_INPUT"});
  const source=await db.query(`SELECT c.*,i.protocol AS "incidentProtocol" FROM abnormal_situation_cases c
    LEFT JOIN incidents i ON i.id=c.incident_id WHERE c.id=$1 AND c.organization_id=$2`,[id,org]);
  const row=source.rows[0];if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  const duplicate=await db.query(`SELECT id FROM s2id_records WHERE organization_id=$1 AND record_type=$2
    AND payload->>'anomalyCaseId'=$3 ORDER BY created_at DESC LIMIT 1`,[org,type,id]);
  if(duplicate.rows[0])return reply.code(409).send({error:"S2ID_DRAFT_EXISTS",message:"Já existe um rascunho deste tipo para o processo."});
  const payload={
   anomalyCaseId:id,situationType:row.situation_type,summary:row.summary,decreeNumber:row.decree_number,
   decreeDate:row.decree_date,externalProtocol:row.external_protocol,incidentProtocol:row.incidentProtocol
  };
  const result=await db.query(`INSERT INTO s2id_records(organization_id,incident_id,cobrade,record_type,payload,created_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,status,created_at AS "createdAt"`,[
    org,row.incident_id,row.cobrade_code,type,JSON.stringify(payload),auth.userId
   ]);
  return reply.code(201).send(result.rows[0]);
 });
}
