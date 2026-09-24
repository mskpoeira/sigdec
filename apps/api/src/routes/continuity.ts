import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { defaultSidecRunbookSteps, summarizeSidecContinuityExercise, validateSidecRunbookActivation } from "../lib/sidec-runbook.js";
import { buildContinuityExerciseReportPdf } from "../lib/sidec-continuity-report.js";

const phaseSchema=z.enum(["DECLARATION","COMMUNICATION","PRESERVATION","RECOVERY","VALIDATION","RETURN"]);

const runbookStepSchema=z.object({
 phase:phaseSchema,
 sortOrder:z.number().int().min(1).max(10000),
 title:z.string().trim().min(3).max(240),
 instructions:z.string().trim().min(10).max(12000),
 expectedMinutes:z.number().int().min(1).max(10080),
 ownerUserId:z.string().uuid().nullable().optional(),
 required:z.boolean()
});

const runbookUpdateSchema=z.object({
 title:z.string().trim().min(5).max(240),
 activationCriteria:z.string().trim().max(12000),
 recoveryStrategy:z.string().trim().max(12000),
 communicationPlan:z.string().trim().max(12000),
 returnToNormal:z.string().trim().max(12000),
 steps:z.array(runbookStepSchema).min(6).max(80)
});

const createRevisionSchema=z.object({
 cloneActive:z.boolean().default(true)
});

const exerciseCreateSchema=z.object({
 scenario:z.string().trim().min(10).max(12000).optional(),
 scheduleId:z.string().uuid().optional()
}).refine(value=>Boolean(value.scenario||value.scheduleId),{message:"Informe cenário ou agenda."});

const exerciseStepSchema=z.object({
 status:z.enum(["PENDING","COMPLETED","SKIPPED","FAILED"]),
 notes:z.string().trim().max(4000).nullable().optional()
});

const exerciseFinishSchema=z.object({
 notes:z.string().trim().max(8000).nullable().optional()
});

const exerciseCancelSchema=z.object({
 reason:z.string().trim().min(5).max(8000)
});

const evidenceSchema=z.object({
 evidenceType:z.enum(["NOTE","LINK","DOCUMENT","HASH"]),
 title:z.string().trim().min(3).max(240),
 reference:z.string().trim().min(1).max(8000),
 contentHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()
});

const aarUpdateSchema=z.object({
 executiveSummary:z.string().trim().min(10).max(12000),
 strengths:z.string().trim().min(5).max(12000),
 gaps:z.string().trim().min(5).max(12000),
 recommendations:z.string().trim().min(5).max(12000)
});

const aarActionCreateSchema=z.object({
 title:z.string().trim().min(3).max(240),
 description:z.string().trim().max(8000).default(""),
 priority:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("MEDIUM"),
 ownerUserId:z.string().uuid().nullable().optional(),
 dueAt:z.coerce.date().nullable().optional()
});

const aarActionUpdateSchema=z.object({
 title:z.string().trim().min(3).max(240).optional(),
 description:z.string().trim().max(8000).optional(),
 priority:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).optional(),
 ownerUserId:z.string().uuid().nullable().optional(),
 dueAt:z.coerce.date().nullable().optional(),
 status:z.enum(["OPEN","IN_PROGRESS","DONE","CANCELLED"]).optional()
});

const scheduleCreateSchema=z.object({
 name:z.string().trim().min(3).max(240),
 intervalDays:z.number().int().min(7).max(1095),
 nextDueAt:z.coerce.date(),
 defaultScenario:z.string().trim().min(10).max(12000),
 ownerUserId:z.string().uuid().nullable().optional(),
 enabled:z.boolean().default(true)
});
const scheduleUpdateSchema=scheduleCreateSchema.partial();

const continuityContactSchema=z.object({
 contactScope:z.enum(["INTERNAL","EXTERNAL"]),
 escalationLevel:z.number().int().min(1).max(5),
 name:z.string().trim().min(2).max(200),
 roleTitle:z.string().trim().max(200).nullable().optional(),
 organizationName:z.string().trim().max(240).nullable().optional(),
 channelType:z.enum(["PHONE","EMAIL","RADIO","OTHER"]),
 channelValue:z.string().trim().min(2).max(500),
 notes:z.string().trim().max(4000).nullable().optional(),
 active:z.boolean().default(true)
});

const continuityLessonSchema=z.object({
 category:z.enum(["PROCESS","PEOPLE","TECHNOLOGY","COMMUNICATION","DATA","STORAGE","CONNECTIVITY","OTHER"]),
 recurrenceKey:z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
 title:z.string().trim().min(3).max(240),
 observation:z.string().trim().min(5).max(8000),
 severity:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("MEDIUM")
});



function organizationId(value:string|null){
 if(!value){
  const error=new Error("Usuário sem organização vinculada.");
  (error as Error&{statusCode?:number}).statusCode=409;
  throw error;
 }
 return value;
}

async function loadRunbookPlan(org:string,id:string){
 const planResult=await db.query(`SELECT p.id,p.version,p.title,p.status,
   p.activation_criteria AS "activationCriteria",
   p.recovery_strategy AS "recoveryStrategy",
   p.communication_plan AS "communicationPlan",
   p.return_to_normal AS "returnToNormal",
   p.created_at AS "createdAt",p.updated_at AS "updatedAt",p.activated_at AS "activatedAt",
   creator.display_name AS "createdByName",activator.display_name AS "activatedByName"
  FROM sidec_continuity_plans p
  LEFT JOIN users creator ON creator.id=p.created_by
  LEFT JOIN users activator ON activator.id=p.activated_by
  WHERE p.organization_id=$1 AND p.id=$2`,[org,id]);
 const plan=planResult.rows[0];
 if(!plan)return null;
 const steps=await db.query(`SELECT s.id,s.phase,s.sort_order AS "sortOrder",s.title,s.instructions,
   s.expected_minutes AS "expectedMinutes",s.owner_user_id AS "ownerUserId",s.required,
   u.display_name AS "ownerName",u.matricula AS "ownerMatricula",u.job_title AS "ownerJobTitle"
  FROM sidec_continuity_steps s
  LEFT JOIN users u ON u.id=s.owner_user_id
  WHERE s.plan_id=$1
  ORDER BY s.sort_order`,[id]);
 return {...plan,steps:steps.rows};
}

async function operators(org:string){
 const r=await db.query(`SELECT id,matricula,display_name AS "displayName",job_title AS "jobTitle",department
  FROM users WHERE organization_id=$1 ORDER BY display_name,matricula`,[org]);
 return r.rows;
}

async function loadExercise(org:string,id:string){
 const exerciseResult=await db.query(`SELECT e.id,e.plan_id AS "planId",p.version AS "planVersion",p.title AS "planTitle",
   e.scenario,e.status,e.result,e.notes,e.started_at AS "startedAt",e.completed_at AS "completedAt",
   creator.display_name AS "createdByName",finisher.display_name AS "completedByName"
  FROM sidec_continuity_exercises e
  JOIN sidec_continuity_plans p ON p.id=e.plan_id
  LEFT JOIN users creator ON creator.id=e.created_by
  LEFT JOIN users finisher ON finisher.id=e.completed_by
  WHERE e.organization_id=$1 AND e.id=$2`,[org,id]);
 const exercise=exerciseResult.rows[0];
 if(!exercise)return null;
 const [stepResult,evidenceResult,aarResult]=await Promise.all([
  db.query(`SELECT es.step_id AS "stepId",s.phase,s.sort_order AS "sortOrder",s.title,
    s.instructions,s.expected_minutes AS "expectedMinutes",s.required,s.owner_user_id AS "ownerUserId",
    owner.display_name AS "ownerName",es.status,es.notes,es.completed_at AS "completedAt",
    actor.display_name AS "completedByName"
   FROM sidec_continuity_exercise_steps es
   JOIN sidec_continuity_steps s ON s.id=es.step_id
   LEFT JOIN users owner ON owner.id=s.owner_user_id
   LEFT JOIN users actor ON actor.id=es.completed_by
   WHERE es.exercise_id=$1
   ORDER BY s.sort_order`,[id]),
  db.query(`SELECT ev.id,ev.step_id AS "stepId",ev.evidence_type AS "evidenceType",ev.title,ev.reference,
    ev.content_hash AS "contentHash",ev.created_at AS "createdAt",u.display_name AS "createdByName"
   FROM sidec_continuity_step_evidence ev
   LEFT JOIN users u ON u.id=ev.created_by
   WHERE ev.organization_id=$1 AND ev.exercise_id=$2
   ORDER BY ev.created_at`,[org,id]),
  db.query(`SELECT a.id,a.status,a.executive_summary AS "executiveSummary",a.strengths,a.gaps,a.recommendations,
    a.created_at AS "createdAt",a.updated_at AS "updatedAt",a.finalized_at AS "finalizedAt",
    creator.display_name AS "createdByName",finalizer.display_name AS "finalizedByName"
   FROM sidec_continuity_aars a
   LEFT JOIN users creator ON creator.id=a.created_by
   LEFT JOIN users finalizer ON finalizer.id=a.finalized_by
   WHERE a.organization_id=$1 AND a.exercise_id=$2`,[org,id])
 ]);
 const evidenceByStep=new Map<string,any[]>();
 for(const evidence of evidenceResult.rows){
  const key=String(evidence.stepId),list=evidenceByStep.get(key)??[];
  list.push(evidence);evidenceByStep.set(key,list);
 }
 const steps=stepResult.rows.map((row:any)=>({...row,evidence:evidenceByStep.get(String(row.stepId))??[]}));
 const summary=summarizeSidecContinuityExercise(steps.map((row:any)=>({required:Boolean(row.required),status:row.status})));
 const aarRow=aarResult.rows[0];
 let aar:any=null;
 if(aarRow){
  const actions=await db.query(`SELECT ai.id,ai.title,ai.description,ai.priority,ai.owner_user_id AS "ownerUserId",
    owner.display_name AS "ownerName",owner.matricula AS "ownerMatricula",ai.due_at AS "dueAt",ai.status,
    ai.completed_at AS "completedAt",ai.created_at AS "createdAt",ai.updated_at AS "updatedAt"
   FROM sidec_continuity_action_items ai
   LEFT JOIN users owner ON owner.id=ai.owner_user_id
   WHERE ai.aar_id=$1
   ORDER BY CASE ai.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
    ai.due_at NULLS LAST,ai.created_at`,[aarRow.id]);
  aar={...aarRow,actions:actions.rows};
 }
 return {...exercise,summary,steps,aar};
}

export async function evaluateContinuityActionAlerts(organizationId?:string){
 const dueSoonHours=Math.max(1,Math.min(720,Number(process.env.SIDEC_CONTINUITY_ACTION_DUE_SOON_HOURS??72)));
 const params:unknown[]=[];
 let where="";
 if(organizationId){params.push(organizationId);where="AND a.organization_id=$1";}
 const actions=await db.query(`SELECT ai.id AS "actionId",ai.due_at AS "dueAt",ai.status,a.organization_id AS "organizationId"
  FROM sidec_continuity_action_items ai
  JOIN sidec_continuity_aars a ON a.id=ai.aar_id
  WHERE ai.status IN ('OPEN','IN_PROGRESS') AND ai.due_at IS NOT NULL ${where}`,params);
 let created=0;
 const now=Date.now();
 for(const row of actions.rows as Array<any>){
  const due=new Date(row.dueAt).getTime();
  const alertType=due<=now?"OVERDUE":due<=now+dueSoonHours*60*60*1000?"DUE_SOON":null;
  if(!alertType)continue;
  const inserted=await db.query(`INSERT INTO sidec_continuity_action_alerts(
    organization_id,action_id,alert_type,due_at
   ) VALUES($1,$2,$3,$4)
   ON CONFLICT(action_id,alert_type,due_at) DO NOTHING RETURNING id`,
   [row.organizationId,row.actionId,alertType,row.dueAt]);
  if(inserted.rows[0])created++;
 }
 return {created,dueSoonHours};
}

export async function continuityRoutes(app:FastifyInstance){
 app.get("/api/v1/sidec/continuity/runbook",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const revisions=await db.query(`SELECT id,version,title,status,created_at AS "createdAt",
    updated_at AS "updatedAt",activated_at AS "activatedAt"
   FROM sidec_continuity_plans
   WHERE organization_id=$1
   ORDER BY version DESC LIMIT 30`,[org]);
  const activeRow=revisions.rows.find((x:any)=>x.status==="ACTIVE");
  const draftRow=revisions.rows.find((x:any)=>x.status==="DRAFT");
  const [active,draft,people]=await Promise.all([
   activeRow?loadRunbookPlan(org,String(activeRow.id)):Promise.resolve(null),
   draftRow?loadRunbookPlan(org,String(draftRow.id)):Promise.resolve(null),
   operators(org)
  ]);
  return {active,draft,revisions:revisions.rows,operators:people};
 });

 app.post("/api/v1/sidec/continuity/runbook/revisions",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=createRevisionSchema.safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const existingDraft=await db.query(`SELECT id FROM sidec_continuity_plans WHERE organization_id=$1 AND status='DRAFT'`,[org]);
  if(existingDraft.rows[0])return reply.code(409).send({error:"DRAFT_ALREADY_EXISTS",draftId:existingDraft.rows[0].id});
  const versionRow=await db.query(`SELECT COALESCE(max(version),0)::int+1 AS version FROM sidec_continuity_plans WHERE organization_id=$1`,[org]);
  const version=Number(versionRow.rows[0]?.version??1);
  const active=parsed.data.cloneActive
   ?(await db.query(`SELECT * FROM sidec_continuity_plans WHERE organization_id=$1 AND status='ACTIVE'`,[org])).rows[0]
   :null;
  const activeSteps=active
   ?(await db.query(`SELECT phase,sort_order AS "sortOrder",title,instructions,expected_minutes AS "expectedMinutes",
      owner_user_id AS "ownerUserId",required FROM sidec_continuity_steps WHERE plan_id=$1 ORDER BY sort_order`,[active.id])).rows
   :null;
  const defaults=defaultSidecRunbookSteps(auth.userId);
  const sourceSteps=activeSteps?.length?activeSteps:defaults;
  const fields=active?{
   title:String(active.title),
   activationCriteria:String(active.activation_criteria??""),
   recoveryStrategy:String(active.recovery_strategy??""),
   communicationPlan:String(active.communication_plan??""),
   returnToNormal:String(active.return_to_normal??"")
  }:{
   title:`Plano de Continuidade SIDEC — revisão ${version}`,
   activationCriteria:"Ativar quando houver indisponibilidade relevante confirmada, perda de acesso aos artefatos ou necessidade formal de recuperação controlada.",
   recoveryStrategy:"Preservar evidências, validar o WORM e as réplicas, restaurar somente em ambiente autorizado e comprovar integridade antes do uso.",
   communicationPlan:"Acionar os responsáveis formais, registrar horários e decisões e manter canal alternativo de coordenação durante a contingência.",
   returnToNormal:"Retornar à operação normal somente após validação técnica, registro das pendências, comunicação do encerramento e preservação das evidências."
  };

  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const created=await client.query(`INSERT INTO sidec_continuity_plans(
      organization_id,version,title,status,activation_criteria,recovery_strategy,communication_plan,return_to_normal,created_by
     ) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8)
     RETURNING id`,[org,version,fields.title,fields.activationCriteria,fields.recoveryStrategy,fields.communicationPlan,fields.returnToNormal,auth.userId]);
   const id=String(created.rows[0].id);
   for(const step of sourceSteps){
    await client.query(`INSERT INTO sidec_continuity_steps(
      plan_id,phase,sort_order,title,instructions,expected_minutes,owner_user_id,required
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[
      id,step.phase,Number(step.sortOrder),step.title,step.instructions,Number(step.expectedMinutes),
      step.ownerUserId??auth.userId,Boolean(step.required)
    ]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.runbook_revision_create','sidec_continuity_plan',$2,$3,$4,$5::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({version,cloneActive:Boolean(active)})
   ]);
   await client.query("COMMIT");
   return reply.code(201).send(await loadRunbookPlan(org,id));
  }catch(error){
   await client.query("ROLLBACK");
   throw error;
  }finally{client.release();}
 });

 app.put("/api/v1/sidec/continuity/runbook/:id",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=runbookUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const sortOrders=new Set<number>();
  for(const step of parsed.data.steps){
   if(sortOrders.has(step.sortOrder))return reply.code(400).send({error:"DUPLICATE_SORT_ORDER",sortOrder:step.sortOrder});
   sortOrders.add(step.sortOrder);
  }
  const owners=[...new Set(parsed.data.steps.map(x=>x.ownerUserId).filter((x):x is string=>Boolean(x)))];
  if(owners.length){
   const valid=await db.query(`SELECT id FROM users WHERE organization_id=$1 AND id=ANY($2::uuid[])`,[org,owners]);
   if(valid.rows.length!==owners.length)return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});
  }
  const before=await loadRunbookPlan(org,id);
  if(!before)return reply.code(404).send({error:"NOT_FOUND"});
  if(before.status!=="DRAFT")return reply.code(409).send({error:"IMMUTABLE_REVISION",status:before.status});
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query(`UPDATE sidec_continuity_plans SET title=$1,activation_criteria=$2,recovery_strategy=$3,
     communication_plan=$4,return_to_normal=$5,updated_at=now()
     WHERE id=$6 AND organization_id=$7 AND status='DRAFT'`,[
    parsed.data.title,parsed.data.activationCriteria,parsed.data.recoveryStrategy,
    parsed.data.communicationPlan,parsed.data.returnToNormal,id,org
   ]);
   await client.query("DELETE FROM sidec_continuity_steps WHERE plan_id=$1",[id]);
   for(const step of parsed.data.steps){
    await client.query(`INSERT INTO sidec_continuity_steps(
      plan_id,phase,sort_order,title,instructions,expected_minutes,owner_user_id,required
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[
      id,step.phase,step.sortOrder,step.title,step.instructions,step.expectedMinutes,step.ownerUserId??null,step.required
    ]);
   }
   const afterSnapshot={...parsed.data,id,version:before.version,status:"DRAFT"};
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_continuity.runbook_update','sidec_continuity_plan',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before),JSON.stringify(afterSnapshot)
   ]);
   await client.query("COMMIT");
   return loadRunbookPlan(org,id);
  }catch(error){
   await client.query("ROLLBACK");
   throw error;
  }finally{client.release();}
 });

 app.post("/api/v1/sidec/continuity/runbook/:id/activate",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const plan=await loadRunbookPlan(org,id);
  if(!plan)return reply.code(404).send({error:"NOT_FOUND"});
  if(plan.status!=="DRAFT")return reply.code(409).send({error:"IMMUTABLE_REVISION",status:plan.status});
  const validation=validateSidecRunbookActivation({
   title:String(plan.title),
   activationCriteria:String(plan.activationCriteria??""),
   recoveryStrategy:String(plan.recoveryStrategy??""),
   communicationPlan:String(plan.communicationPlan??""),
   returnToNormal:String(plan.returnToNormal??""),
   steps:plan.steps.map((x:any)=>({
    phase:String(x.phase),title:String(x.title),instructions:String(x.instructions),
    ownerUserId:x.ownerUserId?String(x.ownerUserId):null,required:Boolean(x.required)
   }))
  });
  if(!validation.valid)return reply.code(409).send({error:"RUNBOOK_NOT_READY",details:validation.errors});
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query(`UPDATE sidec_continuity_plans SET status='RETIRED',updated_at=now()
     WHERE organization_id=$1 AND status='ACTIVE'`,[org]);
   await client.query(`UPDATE sidec_continuity_plans SET status='ACTIVE',activated_by=$1,activated_at=now(),updated_at=now()
     WHERE organization_id=$2 AND id=$3 AND status='DRAFT'`,[auth.userId,org,id]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.runbook_activate','sidec_continuity_plan',$2,$3,$4,$5::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({version:plan.version})
   ]);
   await client.query("COMMIT");
   return loadRunbookPlan(org,id);
  }catch(error){
   await client.query("ROLLBACK");
   throw error;
  }finally{client.release();}
 });

 app.get("/api/v1/sidec/continuity/schedules",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const r=await db.query(`SELECT s.id,s.name,s.interval_days AS "intervalDays",s.next_due_at AS "nextDueAt",
    s.default_scenario AS "defaultScenario",s.owner_user_id AS "ownerUserId",u.display_name AS "ownerName",
    s.enabled,s.last_exercise_id AS "lastExerciseId",s.created_at AS "createdAt",s.updated_at AS "updatedAt",
    CASE WHEN s.enabled=false THEN 'DISABLED'
      WHEN s.next_due_at<=now() THEN 'OVERDUE'
      WHEN s.next_due_at<=now()+interval '7 days' THEN 'DUE_SOON'
      ELSE 'SCHEDULED' END AS "dueState"
    FROM sidec_continuity_schedules s
    LEFT JOIN users u ON u.id=s.owner_user_id
    WHERE s.organization_id=$1 ORDER BY s.enabled DESC,s.next_due_at,s.name`,[org]);
  return {items:r.rows};
 });

 app.post("/api/v1/sidec/continuity/schedules",{preHandler:requirePermission("sidec_continuity_schedule.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=scheduleCreateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  if(parsed.data.ownerUserId){
   const owner=await db.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2",[parsed.data.ownerUserId,org]);
   if(!owner.rows[0])return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});
  }
  const created=await db.query(`INSERT INTO sidec_continuity_schedules(
    organization_id,name,interval_days,next_due_at,default_scenario,owner_user_id,enabled,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   RETURNING id,name,interval_days AS "intervalDays",next_due_at AS "nextDueAt",default_scenario AS "defaultScenario",
    owner_user_id AS "ownerUserId",enabled,created_at AS "createdAt"`,[
    org,parsed.data.name,parsed.data.intervalDays,parsed.data.nextDueAt,parsed.data.defaultScenario,
    parsed.data.ownerUserId??null,parsed.data.enabled,auth.userId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.schedule_create','sidec_continuity_schedule',$2,$3,$4,$5::jsonb)`,[
    auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0])
  ]);
  return reply.code(201).send(created.rows[0]);
 });

 app.patch("/api/v1/sidec/continuity/schedules/:id",{preHandler:requirePermission("sidec_continuity_schedule.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=scheduleUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const beforeResult=await db.query(`SELECT * FROM sidec_continuity_schedules WHERE id=$1 AND organization_id=$2`,[id,org]);
  const before=beforeResult.rows[0] as any;if(!before)return reply.code(404).send({error:"NOT_FOUND"});
  const ownerUserId=parsed.data.ownerUserId===undefined?before.owner_user_id:parsed.data.ownerUserId;
  if(ownerUserId){
   const owner=await db.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2",[ownerUserId,org]);
   if(!owner.rows[0])return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});
  }
  const updated=await db.query(`UPDATE sidec_continuity_schedules SET name=$1,interval_days=$2,next_due_at=$3,
    default_scenario=$4,owner_user_id=$5,enabled=$6,updated_at=now()
    WHERE id=$7 AND organization_id=$8
    RETURNING id,name,interval_days AS "intervalDays",next_due_at AS "nextDueAt",default_scenario AS "defaultScenario",
     owner_user_id AS "ownerUserId",enabled,updated_at AS "updatedAt"`,[
    parsed.data.name??before.name,parsed.data.intervalDays??before.interval_days,
    parsed.data.nextDueAt??before.next_due_at,parsed.data.defaultScenario??before.default_scenario,
    ownerUserId,parsed.data.enabled??before.enabled,id,org
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_continuity.schedule_update','sidec_continuity_schedule',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before),JSON.stringify(updated.rows[0])
  ]);
  return updated.rows[0];
 });

 app.get("/api/v1/sidec/continuity/contacts",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const r=await db.query(`SELECT id,contact_scope AS "contactScope",escalation_level AS "escalationLevel",name,
    role_title AS "roleTitle",organization_name AS "organizationName",channel_type AS "channelType",
    channel_value AS "channelValue",notes,active,created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sidec_continuity_contacts WHERE organization_id=$1
    ORDER BY active DESC,escalation_level,name`,[org]);
  return {items:r.rows};
 });

 app.post("/api/v1/sidec/continuity/contacts",{preHandler:requirePermission("sidec_continuity_contacts.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=continuityContactSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data;
  const created=await db.query(`INSERT INTO sidec_continuity_contacts(
    organization_id,contact_scope,escalation_level,name,role_title,organization_name,channel_type,channel_value,notes,active,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   RETURNING id,contact_scope AS "contactScope",escalation_level AS "escalationLevel",name,role_title AS "roleTitle",
    organization_name AS "organizationName",channel_type AS "channelType",channel_value AS "channelValue",notes,active`,[
    org,v.contactScope,v.escalationLevel,v.name,v.roleTitle??null,v.organizationName??null,v.channelType,
    v.channelValue,v.notes??null,v.active,auth.userId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.contact_create','sidec_continuity_contact',$2,$3,$4,$5::jsonb)`,[
    auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0])
  ]);
  return reply.code(201).send(created.rows[0]);
 });

 app.patch("/api/v1/sidec/continuity/contacts/:id",{preHandler:requirePermission("sidec_continuity_contacts.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=continuityContactSchema.partial().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const beforeResult=await db.query("SELECT * FROM sidec_continuity_contacts WHERE id=$1 AND organization_id=$2",[id,org]);
  const before=beforeResult.rows[0] as any;if(!before)return reply.code(404).send({error:"NOT_FOUND"});
  const v=parsed.data;
  const updated=await db.query(`UPDATE sidec_continuity_contacts SET contact_scope=$1,escalation_level=$2,name=$3,
    role_title=$4,organization_name=$5,channel_type=$6,channel_value=$7,notes=$8,active=$9,updated_at=now()
    WHERE id=$10 AND organization_id=$11
    RETURNING id,contact_scope AS "contactScope",escalation_level AS "escalationLevel",name,role_title AS "roleTitle",
    organization_name AS "organizationName",channel_type AS "channelType",channel_value AS "channelValue",notes,active`,[
    v.contactScope??before.contact_scope,v.escalationLevel??before.escalation_level,v.name??before.name,
    v.roleTitle===undefined?before.role_title:v.roleTitle,v.organizationName===undefined?before.organization_name:v.organizationName,
    v.channelType??before.channel_type,v.channelValue??before.channel_value,v.notes===undefined?before.notes:v.notes,
    v.active??before.active,id,org
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_continuity.contact_update','sidec_continuity_contact',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before),JSON.stringify(updated.rows[0])
  ]);
  return updated.rows[0];
 });

 app.get("/api/v1/sidec/continuity/action-alerts",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const evaluation=await evaluateContinuityActionAlerts(org);
  const r=await db.query(`SELECT al.id,al.action_id AS "actionId",al.alert_type AS "alertType",al.due_at AS "dueAt",
    al.detected_at AS "detectedAt",ai.title,ai.priority,ai.status,owner.display_name AS "ownerName",
    e.id AS "exerciseId",e.scenario,p.version AS "planVersion"
    FROM sidec_continuity_action_alerts al
    JOIN sidec_continuity_action_items ai ON ai.id=al.action_id
    JOIN sidec_continuity_aars a ON a.id=ai.aar_id
    JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
    JOIN sidec_continuity_plans p ON p.id=e.plan_id
    LEFT JOIN users owner ON owner.id=ai.owner_user_id
    WHERE al.organization_id=$1 AND al.acknowledged_at IS NULL
      AND ai.status IN ('OPEN','IN_PROGRESS') AND ai.due_at=al.due_at
      AND (
       (al.alert_type='OVERDUE' AND ai.due_at<=now()) OR
       (al.alert_type='DUE_SOON' AND ai.due_at>now() AND ai.due_at<=now()+($2::text||' hours')::interval)
      )
    ORDER BY CASE al.alert_type WHEN 'OVERDUE' THEN 1 ELSE 2 END,
      CASE ai.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,ai.due_at`,[org,evaluation.dueSoonHours]);
  return {dueSoonHours:evaluation.dueSoonHours,items:r.rows};
 });

 app.patch("/api/v1/sidec/continuity/action-alerts/:id/ack",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const updated=await db.query(`UPDATE sidec_continuity_action_alerts SET acknowledged_at=COALESCE(acknowledged_at,now()),
    acknowledged_by=CASE WHEN acknowledged_at IS NULL THEN $1 ELSE acknowledged_by END
    WHERE id=$2 AND organization_id=$3
    RETURNING id,acknowledged_at AS "acknowledgedAt"`,[auth.userId,id,org]);
  if(!updated.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.action_alert_ack','sidec_continuity_action_alert',$2,$3,$4,$5::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(updated.rows[0])
  ]);
  return updated.rows[0];
 });

 app.get("/api/v1/sidec/continuity/lessons",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const [summary,recent]=await Promise.all([
   db.query(`SELECT l.recurrence_key AS "recurrenceKey",l.category,count(*)::int AS occurrences,
      max(l.created_at) AS "lastSeenAt",
      array_agg(DISTINCT l.title ORDER BY l.title) AS titles
     FROM sidec_continuity_lessons l
     JOIN sidec_continuity_aars a ON a.id=l.aar_id
     WHERE l.organization_id=$1 AND a.status='FINAL'
     GROUP BY l.recurrence_key,l.category
     ORDER BY count(*) DESC,max(l.created_at) DESC LIMIT 50`,[org]),
   db.query(`SELECT l.id,l.category,l.recurrence_key AS "recurrenceKey",l.title,l.observation,l.severity,
      l.created_at AS "createdAt",e.id AS "exerciseId",p.version AS "planVersion"
     FROM sidec_continuity_lessons l
     JOIN sidec_continuity_aars a ON a.id=l.aar_id
     JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
     JOIN sidec_continuity_plans p ON p.id=e.plan_id
     WHERE l.organization_id=$1
     ORDER BY l.created_at DESC LIMIT 100`,[org])
  ]);
  return {summary:summary.rows,recent:recent.rows};
 });

 app.post("/api/v1/sidec/continuity/exercises/:id/aar/lessons",{preHandler:requirePermission("sidec_continuity_lessons.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=continuityLessonSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const aarResult=await db.query(`SELECT a.id,a.status FROM sidec_continuity_aars a
    JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
    WHERE a.exercise_id=$1 AND a.organization_id=$2 AND e.status='COMPLETED'`,[id,org]);
  const aar=aarResult.rows[0];
  if(!aar)return reply.code(409).send({error:"AAR_DRAFT_REQUIRED"});
  if(aar.status!=="DRAFT")return reply.code(409).send({error:"AAR_IMMUTABLE"});
  const v=parsed.data;
  const created=await db.query(`INSERT INTO sidec_continuity_lessons(
    organization_id,aar_id,category,recurrence_key,title,observation,severity,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   RETURNING id,category,recurrence_key AS "recurrenceKey",title,observation,severity,created_at AS "createdAt"`,[
    org,aar.id,v.category,v.recurrenceKey,v.title,v.observation,v.severity,auth.userId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'sidec_continuity.lesson_create','sidec_continuity_lesson',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,
    JSON.stringify(created.rows[0]),JSON.stringify({exerciseId:id,aarId:aar.id})
  ]);
  return reply.code(201).send(created.rows[0]);
 });

 app.get("/api/v1/sidec/continuity/exercises",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const rows=await db.query(`SELECT id FROM sidec_continuity_exercises
   WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 20`,[org]);
  const items=[];
  for(const row of rows.rows){
   const item=await loadExercise(org,String(row.id));
   if(item)items.push(item);
  }
  return {items};
 });

 app.post("/api/v1/sidec/continuity/exercises",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=exerciseCreateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const active=await db.query(`SELECT id,version FROM sidec_continuity_plans WHERE organization_id=$1 AND status='ACTIVE'`,[org]);
  const plan=active.rows[0];
  if(!plan)return reply.code(409).send({error:"ACTIVE_RUNBOOK_REQUIRED"});
  const open=await db.query(`SELECT id FROM sidec_continuity_exercises WHERE organization_id=$1 AND status='IN_PROGRESS'`,[org]);
  if(open.rows[0])return reply.code(409).send({error:"EXERCISE_ALREADY_IN_PROGRESS",exerciseId:open.rows[0].id});
  let schedule:any=null;
  if(parsed.data.scheduleId){
   const scheduleResult=await db.query(`SELECT id,name,interval_days AS "intervalDays",next_due_at AS "nextDueAt",
     default_scenario AS "defaultScenario",enabled
     FROM sidec_continuity_schedules WHERE id=$1 AND organization_id=$2`,[parsed.data.scheduleId,org]);
   schedule=scheduleResult.rows[0];
   if(!schedule)return reply.code(404).send({error:"SCHEDULE_NOT_FOUND"});
   if(!schedule.enabled)return reply.code(409).send({error:"SCHEDULE_DISABLED"});
  }
  const scenario=parsed.data.scenario??schedule?.defaultScenario;
  if(!scenario)return reply.code(400).send({error:"SCENARIO_REQUIRED"});
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const created=await client.query(`INSERT INTO sidec_continuity_exercises(
      organization_id,plan_id,scenario,status,created_by
     ) VALUES($1,$2,$3,'IN_PROGRESS',$4) RETURNING id`,[org,plan.id,scenario,auth.userId]);
   const exerciseId=String(created.rows[0].id);
   await client.query(`INSERT INTO sidec_continuity_exercise_steps(exercise_id,step_id)
    SELECT $1,id FROM sidec_continuity_steps WHERE plan_id=$2 ORDER BY sort_order`,[exerciseId,plan.id]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.exercise_start','sidec_continuity_exercise',$2,$3,$4,$5::jsonb)`,[
    auth.userId,exerciseId,request.ip,request.headers["user-agent"]??null,
    JSON.stringify({planId:plan.id,planVersion:plan.version,scenario,scheduleId:schedule?.id??null})
   ]);
   if(schedule){
    const base=new Date(schedule.nextDueAt);
    const now=new Date();
    while(base.getTime()<=now.getTime())base.setUTCDate(base.getUTCDate()+Number(schedule.intervalDays));
    await client.query(`UPDATE sidec_continuity_schedules
      SET last_exercise_id=$1,next_due_at=$2,updated_at=now()
      WHERE id=$3 AND organization_id=$4`,[exerciseId,base,schedule.id,org]);
   }
   await client.query("COMMIT");
   return reply.code(201).send(await loadExercise(org,exerciseId));
  }catch(error){
   await client.query("ROLLBACK");
   throw error;
  }finally{client.release();}
 });

 app.patch("/api/v1/sidec/continuity/exercises/:exerciseId/steps/:stepId",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const {exerciseId,stepId}=request.params as {exerciseId:string;stepId:string};
  const parsed=exerciseStepSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const exists=await db.query(`SELECT 1 FROM sidec_continuity_exercises WHERE id=$1 AND organization_id=$2 AND status='IN_PROGRESS'`,[exerciseId,org]);
  if(!exists.rows[0])return reply.code(409).send({error:"EXERCISE_NOT_EDITABLE"});
  const status=parsed.data.status;
  const updated=await db.query(`UPDATE sidec_continuity_exercise_steps
    SET status=$1,notes=$2,completed_by=$3,completed_at=$4
    WHERE exercise_id=$5 AND step_id=$6 RETURNING step_id AS "stepId"`,[
    status,parsed.data.notes??null,status==="PENDING"?null:auth.userId,status==="PENDING"?null:new Date(),exerciseId,stepId
  ]);
  if(!updated.rows[0])return reply.code(404).send({error:"STEP_NOT_FOUND"});
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
   VALUES($1,'sidec_continuity.exercise_step','sidec_continuity_exercise',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,exerciseId,request.ip,request.headers["user-agent"]??null,
    JSON.stringify({stepId,status,notes:parsed.data.notes??null}),JSON.stringify({stepId})
  ]);
  return loadExercise(org,exerciseId);
 });

 app.post("/api/v1/sidec/continuity/exercises/:id/finish",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=exerciseFinishSchema.safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const exercise=await loadExercise(org,id);
  if(!exercise)return reply.code(404).send({error:"NOT_FOUND"});
  if(exercise.status!=="IN_PROGRESS")return reply.code(409).send({error:"EXERCISE_NOT_EDITABLE",status:exercise.status});
  if(exercise.summary.requiredPending>0)return reply.code(409).send({error:"REQUIRED_STEPS_PENDING",pending:exercise.summary.requiredPending});
  const undocumented=exercise.steps.filter((step:any)=>step.required&&(step.status==="SKIPPED"||step.status==="FAILED")&&!String(step.notes??"").trim()&&!(step.evidence??[]).length);
  if(undocumented.length)return reply.code(409).send({error:"EVIDENCE_REQUIRED_FOR_EXCEPTION",stepIds:undocumented.map((step:any)=>step.stepId)});
  const result=exercise.summary.result??"PARTIAL";
  await db.query(`UPDATE sidec_continuity_exercises SET status='COMPLETED',result=$1,notes=$2,
    completed_by=$3,completed_at=now() WHERE id=$4 AND organization_id=$5`,[
    result,parsed.data.notes??null,auth.userId,id,org
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
   VALUES($1,'sidec_continuity.exercise_finish','sidec_continuity_exercise',$2,$3,$4,$5::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({result,summary:exercise.summary,notes:parsed.data.notes??null})
  ]);
  return loadExercise(org,id);
 });

 app.post("/api/v1/sidec/continuity/exercises/:id/cancel",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=exerciseCancelSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const updated=await db.query(`UPDATE sidec_continuity_exercises SET status='CANCELLED',notes=$1,
    completed_by=$2,completed_at=now()
    WHERE id=$3 AND organization_id=$4 AND status='IN_PROGRESS' RETURNING id`,[
    parsed.data.reason,auth.userId,id,org
  ]);
  if(!updated.rows[0])return reply.code(409).send({error:"EXERCISE_NOT_EDITABLE"});
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
   VALUES($1,'sidec_continuity.exercise_cancel','sidec_continuity_exercise',$2,$3,$4,$5::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({reason:parsed.data.reason})
  ]);
  return loadExercise(org,id);
 });
 app.post("/api/v1/sidec/continuity/exercises/:exerciseId/steps/:stepId/evidence",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const {exerciseId,stepId}=request.params as {exerciseId:string;stepId:string};
  const parsed=evidenceSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const valid=await db.query(`SELECT 1 FROM sidec_continuity_exercises e JOIN sidec_continuity_exercise_steps es ON es.exercise_id=e.id WHERE e.id=$1 AND e.organization_id=$2 AND es.step_id=$3`,[exerciseId,org,stepId]);
  if(!valid.rows[0])return reply.code(404).send({error:"STEP_NOT_FOUND"});
  const created=await db.query(`INSERT INTO sidec_continuity_step_evidence(organization_id,exercise_id,step_id,evidence_type,title,reference,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,step_id AS "stepId",evidence_type AS "evidenceType",title,reference,content_hash AS "contentHash",created_at AS "createdAt"`,[org,exerciseId,stepId,parsed.data.evidenceType,parsed.data.title,parsed.data.reference,parsed.data.contentHash??null,auth.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,'sidec_continuity.evidence_create','sidec_continuity_exercise',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,exerciseId,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0]),JSON.stringify({stepId})]);
  return reply.code(201).send(created.rows[0]);
 });

 app.put("/api/v1/sidec/continuity/exercises/:id/aar",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=aarUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const exercise=await db.query(`SELECT status FROM sidec_continuity_exercises WHERE id=$1 AND organization_id=$2`,[id,org]);
  if(!exercise.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  if(exercise.rows[0].status!=="COMPLETED")return reply.code(409).send({error:"COMPLETED_EXERCISE_REQUIRED"});
  const existing=await db.query(`SELECT id,status FROM sidec_continuity_aars WHERE exercise_id=$1 AND organization_id=$2`,[id,org]);
  if(existing.rows[0]?.status==="FINAL")return reply.code(409).send({error:"AAR_IMMUTABLE"});
  let aarId=existing.rows[0]?.id as string|undefined;
  if(aarId){
   await db.query(`UPDATE sidec_continuity_aars SET executive_summary=$1,strengths=$2,gaps=$3,recommendations=$4,updated_at=now() WHERE id=$5 AND organization_id=$6 AND status='DRAFT'`,[parsed.data.executiveSummary,parsed.data.strengths,parsed.data.gaps,parsed.data.recommendations,aarId,org]);
  }else{
   const created=await db.query(`INSERT INTO sidec_continuity_aars(organization_id,exercise_id,status,executive_summary,strengths,gaps,recommendations,created_by) VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7) RETURNING id`,[org,id,parsed.data.executiveSummary,parsed.data.strengths,parsed.data.gaps,parsed.data.recommendations,auth.userId]);
   aarId=String(created.rows[0].id);
  }
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,'sidec_continuity.aar_save','sidec_continuity_aar',$2,$3,$4,$5::jsonb)`,[auth.userId,aarId,request.ip,request.headers["user-agent"]??null,JSON.stringify(parsed.data)]);
  return loadExercise(org,id);
 });

 app.post("/api/v1/sidec/continuity/exercises/:id/aar/actions",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=aarActionCreateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  if(parsed.data.ownerUserId){const owner=await db.query(`SELECT 1 FROM users WHERE id=$1 AND organization_id=$2`,[parsed.data.ownerUserId,org]);if(!owner.rows[0])return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});}
  const aar=await db.query(`SELECT a.id,a.status FROM sidec_continuity_aars a JOIN sidec_continuity_exercises e ON e.id=a.exercise_id WHERE a.exercise_id=$1 AND a.organization_id=$2 AND e.status='COMPLETED'`,[id,org]);
  if(!aar.rows[0])return reply.code(409).send({error:"AAR_DRAFT_REQUIRED"});
  if(aar.rows[0].status!=="DRAFT")return reply.code(409).send({error:"AAR_IMMUTABLE"});
  const created=await db.query(`INSERT INTO sidec_continuity_action_items(aar_id,title,description,priority,owner_user_id,due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,description,priority,owner_user_id AS "ownerUserId",due_at AS "dueAt",status,created_at AS "createdAt"`,[aar.rows[0].id,parsed.data.title,parsed.data.description,parsed.data.priority,parsed.data.ownerUserId??null,parsed.data.dueAt??null]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,'sidec_continuity.aar_action_create','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0]),JSON.stringify({exerciseId:id})]);
  return reply.code(201).send(created.rows[0]);
 });

 app.patch("/api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);const {exerciseId,actionId}=request.params as {exerciseId:string;actionId:string};
  const parsed=aarActionUpdateSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  if(parsed.data.ownerUserId){const owner=await db.query(`SELECT 1 FROM users WHERE id=$1 AND organization_id=$2`,[parsed.data.ownerUserId,org]);if(!owner.rows[0])return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});}
  const current=await db.query(`SELECT ai.*,a.status AS aar_status FROM sidec_continuity_action_items ai JOIN sidec_continuity_aars a ON a.id=ai.aar_id WHERE ai.id=$1 AND a.exercise_id=$2 AND a.organization_id=$3`,[actionId,exerciseId,org]);
  const row=current.rows[0] as any;if(!row)return reply.code(404).send({error:"ACTION_NOT_FOUND"});
  const contentChange=parsed.data.title!==undefined||parsed.data.description!==undefined||parsed.data.priority!==undefined||parsed.data.ownerUserId!==undefined||parsed.data.dueAt!==undefined;
  if(row.aar_status==="FINAL"&&contentChange)return reply.code(409).send({error:"AAR_ACTION_CONTENT_IMMUTABLE"});
  const nextStatus=parsed.data.status??row.status;const completedAt=nextStatus==="DONE"?(row.completed_at??new Date()):null;
  const updated=await db.query(`UPDATE sidec_continuity_action_items SET title=$1,description=$2,priority=$3,owner_user_id=$4,due_at=$5,status=$6,completed_at=$7,updated_at=now() WHERE id=$8 RETURNING id,title,description,priority,owner_user_id AS "ownerUserId",due_at AS "dueAt",status,completed_at AS "completedAt",updated_at AS "updatedAt"`,[parsed.data.title??row.title,parsed.data.description??row.description,parsed.data.priority??row.priority,parsed.data.ownerUserId===undefined?row.owner_user_id:parsed.data.ownerUserId,parsed.data.dueAt===undefined?row.due_at:parsed.data.dueAt,nextStatus,completedAt,actionId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata) VALUES($1,'sidec_continuity.aar_action_update','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[auth.userId,actionId,request.ip,request.headers["user-agent"]??null,JSON.stringify(row),JSON.stringify(updated.rows[0]),JSON.stringify({exerciseId})]);
  return updated.rows[0];
 });

 app.post("/api/v1/sidec/continuity/exercises/:id/aar/finalize",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};const exercise=await loadExercise(org,id);
  if(!exercise)return reply.code(404).send({error:"NOT_FOUND"});if(exercise.status!=="COMPLETED")return reply.code(409).send({error:"COMPLETED_EXERCISE_REQUIRED"});
  const aar=exercise.aar;if(!aar)return reply.code(409).send({error:"AAR_DRAFT_REQUIRED"});if(aar.status==="FINAL")return exercise;
  const incomplete=(aar.actions??[]).filter((action:any)=>action.status!=="CANCELLED"&&(!action.ownerUserId||!action.dueAt));
  if(incomplete.length)return reply.code(409).send({error:"AAR_ACTIONS_INCOMPLETE",actionIds:incomplete.map((action:any)=>action.id)});
  await db.query(`UPDATE sidec_continuity_aars SET status='FINAL',finalized_by=$1,finalized_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='DRAFT'`,[auth.userId,aar.id,org]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,'sidec_continuity.aar_finalize','sidec_continuity_aar',$2,$3,$4,$5::jsonb)`,[auth.userId,aar.id,request.ip,request.headers["user-agent"]??null,JSON.stringify({exerciseId:id,actions:(aar.actions??[]).length})]);
  return loadExercise(org,id);
 });

 app.get("/api/v1/sidec/continuity/exercises/:id/report.pdf",{preHandler:requirePermission("sidec_continuity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};const exercise=await loadExercise(org,id);if(!exercise)return reply.code(404).send({error:"NOT_FOUND"});
  const organization=await db.query(`SELECT name FROM organizations WHERE id=$1`,[org]);
  const pdf=await buildContinuityExerciseReportPdf({organizationName:String(organization.rows[0]?.name??"Organização"),exercise,aar:exercise.aar});
  return reply.type("application/pdf").header("Content-Disposition",`attachment; filename="SIGDEC-continuity-exercise-${id}.pdf"`).header("Content-Length",String(pdf.length)).send(pdf);
 });

}
