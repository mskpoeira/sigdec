import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requireAuth,requirePermission} from "../auth.js";
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

const callTargetInput=z.object({
 targetName:z.string().trim().min(2).max(300),
 organizationName:z.string().trim().max(300).optional().default(""),
 roleName:z.string().trim().max(200).optional().default(""),
 contact:z.string().trim().max(300).optional().default(""),
 channel:z.enum(["PHONE","WHATSAPP","RADIO","EMAIL","OTHER"]).default("OTHER"),
 required:z.boolean().default(true)
});
const callEventInput=z.object({
 status:z.enum(["CALLED","ACKNOWLEDGED","UNREACHABLE","SKIPPED","RESET"]),
 notes:z.string().trim().max(4000).optional().default("")
}).superRefine((value,ctx)=>{
 if((value.status==="SKIPPED"||value.status==="UNREACHABLE")&&value.notes.length<3){
  ctx.addIssue({code:z.ZodIssueCode.custom,path:["notes"],message:"Informe uma justificativa."});
 }
});
const checklistItemInput=z.object({
 level:z.enum(levels),
 title:z.string().trim().min(3).max(1000),
 required:z.boolean().default(true)
});
const checklistEventInput=z.object({
 status:z.enum(["DONE","NOT_APPLICABLE","REOPENED"]),
 notes:z.string().trim().max(4000).optional().default("")
}).superRefine((value,ctx)=>{
 if(value.status==="NOT_APPLICABLE"&&value.notes.length<3){
  ctx.addIssue({code:z.ZodIssueCode.custom,path:["notes"],message:"Justifique o item não aplicável."});
 }
});
const resourceEventInput=z.object({
 resourceType:z.enum(["TEAM","VEHICLE","INVENTORY","COMMUNICATION","MANUAL"]),
 resourceId:z.string().uuid().optional(),
 resourceLabel:z.string().trim().max(300).optional().default(""),
 eventType:z.enum(["MOBILIZED","DEMOBILIZED"]),
 quantity:z.number().positive().max(1_000_000).optional(),
 unit:z.string().trim().max(30).optional().default(""),
 notes:z.string().trim().max(4000).optional().default("")
});
const incidentLinkInput=z.object({protocol:z.string().trim().min(3).max(80)});

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


async function operationalContext(organizationId:string,planId:string,requireActive=false){
 const plan=await db.query(`SELECT id,code,version,title,status,current_level AS "currentLevel"
   FROM contingency_plans WHERE id=$1 AND organization_id=$2`,[planId,organizationId]);
 const row=plan.rows[0];
 if(!row)throw Object.assign(new Error("PLANCON não localizado."),{statusCode:404,code:"NOT_FOUND"});
 const activation=await db.query(`SELECT id::text AS id,from_level AS "fromLevel",to_level AS "toLevel",reason,
   actor_matricula AS "actorMatricula",occurred_at AS "occurredAt"
   FROM contingency_plan_activations WHERE plan_id=$1 AND organization_id=$2
   ORDER BY occurred_at DESC,id DESC LIMIT 1`,[planId,organizationId]);
 if(requireActive&&(!activation.rows[0]||row.currentLevel==="NORMAL")){
  throw Object.assign(new Error("O PLANCON precisa estar ativado acima do nível Normal."),{statusCode:409,code:"PLAN_NOT_ACTIVATED"});
 }
 return {plan:row,activation:activation.rows[0]??null};
}

async function seedPlanOperationalDefinitions(planId:string,organizationId:string,userId:string,callPlan:string[],procedures:string[]){
 if(callPlan.length){
  await db.query(`INSERT INTO plancon_call_targets(organization_id,plan_id,sequence_no,target_name,created_by)
    SELECT $1,$2,x.ord::int,x.value,$3
    FROM jsonb_array_elements_text($4::jsonb) WITH ORDINALITY AS x(value,ord)
    ON CONFLICT(plan_id,sequence_no) DO NOTHING`,[organizationId,planId,userId,JSON.stringify(callPlan)]);
 }
 if(procedures.length){
  await db.query(`INSERT INTO plancon_checklist_items(organization_id,plan_id,level,sequence_no,title,created_by)
    SELECT $1,$2,'EMERGENCY',x.ord::int,x.value,$3
    FROM jsonb_array_elements_text($4::jsonb) WITH ORDINALITY AS x(value,ord)
    ON CONFLICT(plan_id,level,sequence_no) DO NOTHING`,[organizationId,planId,userId,JSON.stringify(procedures)]);
 }
}

export async function contingencyRoutes(app:FastifyInstance){
 app.get("/api/v1/planning/cobrade",{preHandler:requireAuth},async(request,reply)=>{
  const parsed=z.object({search:z.string().trim().max(120).default("")}).safeParse(request.query??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_QUERY"});
  const org=organization(request),term=parsed.data.search;
  const values:unknown[]=[org];let filter="";
  if(term){values.push("%"+term+"%");filter=" AND (code ILIKE $2 OR name ILIKE $2)";}
  const result=await db.query(`SELECT code,name,group_name AS "groupName",subgroup_name AS "subgroupName"
    FROM cobrade_catalog WHERE organization_id=$1 AND active=true${filter}
    ORDER BY code LIMIT 100`,values);
  return {items:result.rows};
 });

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
  await seedPlanOperationalDefinitions(result.rows[0].id,org,auth.userId,v.callPlan,v.procedures);
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
  await db.query(`INSERT INTO plancon_call_targets(organization_id,plan_id,sequence_no,target_name,organization_name,role_name,contact,channel,required,created_by)
    SELECT organization_id,$1,sequence_no,target_name,organization_name,role_name,contact,channel,required,$2
    FROM plancon_call_targets WHERE plan_id=$3 ORDER BY sequence_no`,[result.rows[0].id,auth.userId,id]);
  await db.query(`INSERT INTO plancon_checklist_items(organization_id,plan_id,level,sequence_no,title,required,created_by)
    SELECT organization_id,$1,level,sequence_no,title,required,$2
    FROM plancon_checklist_items WHERE plan_id=$3 ORDER BY level,sequence_no`,[result.rows[0].id,auth.userId,id]);
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

 app.get("/api/v1/plancon/:id/operational",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const org=organization(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const context=await operationalContext(org,id,false),activationId=context.activation?.id??null;

  const [calls,checklist,resourceEvents,linkedIncidents,activations,teams,vehicles,inventory,communications,shelters]=await Promise.all([
   db.query(`SELECT t.id,t.sequence_no AS "sequenceNo",t.target_name AS "targetName",t.organization_name AS "organizationName",
     t.role_name AS "roleName",t.contact,t.channel,t.required,
     e.status AS "latestStatus",e.notes AS "latestNotes",e.occurred_at AS "latestAt",e.actor_matricula AS "latestActorMatricula"
     FROM plancon_call_targets t
     LEFT JOIN LATERAL (
       SELECT status,notes,occurred_at,actor_matricula FROM plancon_call_events
       WHERE target_id=t.id AND activation_id=$3 ORDER BY occurred_at DESC,id DESC LIMIT 1
     ) e ON true
     WHERE t.organization_id=$1 AND t.plan_id=$2 ORDER BY t.sequence_no`,[org,id,activationId]),
   db.query(`SELECT i.id,i.level,i.sequence_no AS "sequenceNo",i.title,i.required,
     e.status AS "latestStatus",e.notes AS "latestNotes",e.occurred_at AS "latestAt",e.actor_matricula AS "latestActorMatricula"
     FROM plancon_checklist_items i
     LEFT JOIN LATERAL (
       SELECT status,notes,occurred_at,actor_matricula FROM plancon_checklist_events
       WHERE item_id=i.id AND activation_id=$3 ORDER BY occurred_at DESC,id DESC LIMIT 1
     ) e ON true
     WHERE i.organization_id=$1 AND i.plan_id=$2 AND i.level=$4 ORDER BY i.sequence_no`,[org,id,activationId,context.plan.currentLevel]),
   db.query(`SELECT DISTINCT ON (resource_type,COALESCE(resource_id::text,resource_label))
     id::text AS id,resource_type AS "resourceType",resource_id AS "resourceId",resource_label AS "resourceLabel",
     event_type AS "eventType",quantity,unit,notes,actor_matricula AS "actorMatricula",occurred_at AS "occurredAt"
     FROM plancon_resource_events
     WHERE organization_id=$1 AND plan_id=$2 AND activation_id=$3
     ORDER BY resource_type,COALESCE(resource_id::text,resource_label),occurred_at DESC,id DESC`,[org,id,activationId]),
   db.query(`SELECT l.id,i.id AS "incidentId",i.protocol,i.summary,i.status,i.priority,
     l.linked_by_matricula AS "linkedByMatricula",l.linked_at AS "linkedAt"
     FROM plancon_incident_links l JOIN incidents i ON i.id=l.incident_id
     WHERE l.organization_id=$1 AND l.plan_id=$2 AND l.activation_id=$3
     ORDER BY l.linked_at DESC`,[org,id,activationId]),
   db.query(`SELECT x.id::text AS id,x.from_level AS "fromLevel",x.to_level AS "toLevel",x.reason,
     x.actor_matricula AS "actorMatricula",u.display_name AS "actorName",x.occurred_at AS "occurredAt"
     FROM contingency_plan_activations x JOIN users u ON u.id=x.actor_user_id
     WHERE x.organization_id=$1 AND x.plan_id=$2 ORDER BY x.occurred_at DESC,x.id DESC LIMIT 100`,[org,id]),
   db.query("SELECT id,code,name,status FROM teams WHERE organization_id=$1 AND active=true ORDER BY code",[org]),
   db.query('SELECT id,code,plate,description,status FROM vehicles WHERE organization_id=$1 AND active=true ORDER BY code',[org]),
   db.query(`SELECT i.id,i.code,i.name,i.unit,
     COALESCE(sum(CASE WHEN m.movement_type IN ('IN','ADJUST_IN') THEN m.quantity ELSE -m.quantity END),0)::float8 AS balance
     FROM humanitarian_items i LEFT JOIN humanitarian_stock_movements m ON m.item_id=i.id AND m.organization_id=i.organization_id
     WHERE i.organization_id=$1 AND i.active=true GROUP BY i.id ORDER BY i.name`,[org]),
   db.query("SELECT id,code,description,status,channel FROM communication_assets WHERE organization_id=$1 AND status<>'INACTIVE' ORDER BY code",[org]),
   db.query("SELECT id,name,status,capacity_people AS \"capacityPeople\" FROM shelters WHERE organization_id=$1 ORDER BY name",[org])
  ]);

  const requiredCalls=calls.rows.filter((x:any)=>x.required),ackedCalls=requiredCalls.filter((x:any)=>x.latestStatus==="ACKNOWLEDGED");
  const requiredChecklist=checklist.rows.filter((x:any)=>x.required),doneChecklist=requiredChecklist.filter((x:any)=>x.latestStatus==="DONE"||x.latestStatus==="NOT_APPLICABLE");
  const availableTeams=teams.rows.filter((x:any)=>x.status==="AVAILABLE").length;
  const availableVehicles=vehicles.rows.filter((x:any)=>x.status==="AVAILABLE").length;
  const availableComms=communications.rows.filter((x:any)=>x.status==="AVAILABLE").length;
  const readyShelters=shelters.rows.filter((x:any)=>x.status==="STANDBY"||x.status==="OPEN").length;
  const positiveStock=inventory.rows.filter((x:any)=>Number(x.balance)>0).length;
  const dimension=(ready:number,total:number)=>total===0?"PENDING":ready>0?"READY":"UNAVAILABLE";
  const callState=requiredCalls.length===0?"PENDING":ackedCalls.length===requiredCalls.length?"READY":"PENDING";
  const checklistState=requiredChecklist.length===0?"PENDING":doneChecklist.length===requiredChecklist.length?"READY":"PENDING";
  const states=[dimension(availableTeams,teams.rows.length),dimension(availableVehicles,vehicles.rows.length),dimension(availableComms,communications.rows.length),dimension(readyShelters,shelters.rows.length),dimension(positiveStock,inventory.rows.length),callState,checklistState];
  const overall=states.includes("UNAVAILABLE")?"UNAVAILABLE":states.every(x=>x==="READY")?"READY":"PENDING";

  return {
   plan:context.plan,activation:context.activation,active:Boolean(context.activation&&context.plan.currentLevel!=="NORMAL"),
   readiness:{overall,calls:{state:callState,acknowledged:ackedCalls.length,required:requiredCalls.length},
    checklist:{state:checklistState,done:doneChecklist.length,required:requiredChecklist.length},
    teams:{state:dimension(availableTeams,teams.rows.length),available:availableTeams,total:teams.rows.length},
    vehicles:{state:dimension(availableVehicles,vehicles.rows.length),available:availableVehicles,total:vehicles.rows.length},
    communications:{state:dimension(availableComms,communications.rows.length),available:availableComms,total:communications.rows.length},
    shelters:{state:dimension(readyShelters,shelters.rows.length),ready:readyShelters,total:shelters.rows.length},
    inventory:{state:dimension(positiveStock,inventory.rows.length),positive:positiveStock,total:inventory.rows.length}},
   callTargets:calls.rows,checklist:checklist.rows,resources:resourceEvents.rows,linkedIncidents:linkedIncidents.rows,
   activations:activations.rows,availableResources:{teams:teams.rows,vehicles:vehicles.rows,inventory:inventory.rows,communications:communications.rows,shelters:shelters.rows}
  };
 });

 app.post("/api/v1/plancon/:id/call-targets",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=callTargetInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.success?undefined:parsed.error.flatten()});
  const context=await operationalContext(org,id,false);
  if(context.plan.status!=="DRAFT")return reply.code(409).send({error:"PLAN_VERSION_LOCKED",message:"Crie uma nova revisão para alterar o plano de chamada de um PLANCON aprovado ou ativo."});
  const v=parsed.data;
  const result=await db.query(`INSERT INTO plancon_call_targets(
    organization_id,plan_id,sequence_no,target_name,organization_name,role_name,contact,channel,required,created_by)
    SELECT $1,$2,COALESCE(max(sequence_no),0)+1,$3,$4,$5,$6,$7,$8,$9 FROM plancon_call_targets WHERE plan_id=$2
    RETURNING id,sequence_no AS "sequenceNo"`,[org,id,v.targetName,v.organizationName||null,v.roleName||null,v.contact||null,v.channel,v.required,auth.userId]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/call-targets/:targetId/events",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id,targetId}=request.params as {id:string;targetId:string},parsed=callEventInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!uuid.safeParse(targetId).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.success?undefined:parsed.error.flatten()});
  const context=await operationalContext(org,id,true),matricula=await actorMatricula(request);
  const target=await db.query("SELECT id FROM plancon_call_targets WHERE id=$1 AND plan_id=$2 AND organization_id=$3",[targetId,id,org]);
  if(!target.rows[0])return reply.code(404).send({error:"TARGET_NOT_FOUND"});
  const result=await db.query(`INSERT INTO plancon_call_events(
    organization_id,plan_id,activation_id,target_id,status,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id::text AS id,status,occurred_at AS "occurredAt"`,[org,id,context.activation.id,targetId,parsed.data.status,parsed.data.notes||null,auth.userId,matricula]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/checklist-items",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=checklistItemInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.success?undefined:parsed.error.flatten()});
  const context=await operationalContext(org,id,false);
  if(context.plan.status!=="DRAFT")return reply.code(409).send({error:"PLAN_VERSION_LOCKED",message:"Crie uma nova revisão para alterar o checklist de um PLANCON aprovado ou ativo."});
  const v=parsed.data;
  const result=await db.query(`INSERT INTO plancon_checklist_items(organization_id,plan_id,level,sequence_no,title,required,created_by)
    SELECT $1,$2,$3,COALESCE(max(sequence_no),0)+1,$4,$5,$6 FROM plancon_checklist_items WHERE plan_id=$2 AND level=$3
    RETURNING id,level,sequence_no AS "sequenceNo"`,[org,id,v.level,v.title,v.required,auth.userId]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/checklist/:itemId/events",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id,itemId}=request.params as {id:string;itemId:string},parsed=checklistEventInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!uuid.safeParse(itemId).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.success?undefined:parsed.error.flatten()});
  const context=await operationalContext(org,id,true),matricula=await actorMatricula(request);
  const item=await db.query("SELECT id,level FROM plancon_checklist_items WHERE id=$1 AND plan_id=$2 AND organization_id=$3",[itemId,id,org]);
  if(!item.rows[0])return reply.code(404).send({error:"ITEM_NOT_FOUND"});
  if(item.rows[0].level!==context.plan.currentLevel)return reply.code(409).send({error:"CHECKLIST_LEVEL_MISMATCH"});
  const result=await db.query(`INSERT INTO plancon_checklist_events(
    organization_id,plan_id,activation_id,item_id,status,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id::text AS id,status,occurred_at AS "occurredAt"`,[org,id,context.activation.id,itemId,parsed.data.status,parsed.data.notes||null,auth.userId,matricula]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/resources/events",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=resourceEventInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.success?undefined:parsed.error.flatten()});
  const context=await operationalContext(org,id,true),matricula=await actorMatricula(request),v=parsed.data;
  let resourceLabel=v.resourceLabel,unit=v.unit||null;
  if(v.resourceType!=="MANUAL"&&!v.resourceId)return reply.code(400).send({error:"RESOURCE_ID_REQUIRED"});
  if(v.resourceType==="MANUAL"&&!resourceLabel)return reply.code(400).send({error:"RESOURCE_LABEL_REQUIRED"});
  if(v.resourceType==="TEAM"){
   const x=await db.query("SELECT code,name FROM teams WHERE id=$1 AND organization_id=$2 AND active=true",[v.resourceId,org]);
   if(!x.rows[0])return reply.code(404).send({error:"RESOURCE_NOT_FOUND"});resourceLabel=x.rows[0].code+" · "+x.rows[0].name;
  }else if(v.resourceType==="VEHICLE"){
   const x=await db.query("SELECT code,description FROM vehicles WHERE id=$1 AND organization_id=$2 AND active=true",[v.resourceId,org]);
   if(!x.rows[0])return reply.code(404).send({error:"RESOURCE_NOT_FOUND"});resourceLabel=x.rows[0].code+" · "+x.rows[0].description;
  }else if(v.resourceType==="INVENTORY"){
   const x=await db.query("SELECT code,name,unit FROM humanitarian_items WHERE id=$1 AND organization_id=$2 AND active=true",[v.resourceId,org]);
   if(!x.rows[0])return reply.code(404).send({error:"RESOURCE_NOT_FOUND"});resourceLabel=x.rows[0].code+" · "+x.rows[0].name;unit=unit||x.rows[0].unit;
  }else if(v.resourceType==="COMMUNICATION"){
   const x=await db.query("SELECT code,description FROM communication_assets WHERE id=$1 AND organization_id=$2 AND status<>'INACTIVE'",[v.resourceId,org]);
   if(!x.rows[0])return reply.code(404).send({error:"RESOURCE_NOT_FOUND"});resourceLabel=x.rows[0].code+" · "+x.rows[0].description;
  }
  const result=await db.query(`INSERT INTO plancon_resource_events(
    organization_id,plan_id,activation_id,resource_type,resource_id,resource_label,event_type,quantity,unit,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id::text AS id,event_type AS "eventType",occurred_at AS "occurredAt"`,[
    org,id,context.activation.id,v.resourceType,v.resourceId??null,resourceLabel,v.eventType,v.quantity??null,unit,v.notes||null,auth.userId,matricula
   ]);
  return reply.code(201).send(result.rows[0]);
 });

 app.post("/api/v1/plancon/:id/incidents",{preHandler:requirePermission("plancon.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organization(request),{id}=request.params as {id:string},parsed=incidentLinkInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const context=await operationalContext(org,id,true),matricula=await actorMatricula(request);
  const incident=await db.query("SELECT id FROM incidents WHERE organization_id=$1 AND protocol=$2",[org,parsed.data.protocol]);
  if(!incident.rows[0])return reply.code(404).send({error:"INCIDENT_NOT_FOUND",message:"Protocolo de ocorrência não localizado."});
  try{
   const result=await db.query(`INSERT INTO plancon_incident_links(
     organization_id,plan_id,activation_id,incident_id,linked_by,linked_by_matricula)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id,linked_at AS "linkedAt"`,[
     org,id,context.activation.id,incident.rows[0].id,auth.userId,matricula
    ]);
   return reply.code(201).send(result.rows[0]);
  }catch(error:any){
   if(error?.code==="23505")return reply.code(409).send({error:"INCIDENT_ALREADY_LINKED"});
   throw error;
  }
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
