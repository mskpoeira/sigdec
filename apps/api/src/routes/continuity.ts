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
 scenario:z.string().trim().min(10).max(12000)
});

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
 const stepResult=await db.query(`SELECT es.step_id AS "stepId",s.phase,s.sort_order AS "sortOrder",s.title,
   s.instructions,s.expected_minutes AS "expectedMinutes",s.required,s.owner_user_id AS "ownerUserId",
   owner.display_name AS "ownerName",es.status,es.notes,es.completed_at AS "completedAt",
   actor.display_name AS "completedByName"
  FROM sidec_continuity_exercise_steps es
  JOIN sidec_continuity_steps s ON s.id=es.step_id
  LEFT JOIN users owner ON owner.id=s.owner_user_id
  LEFT JOIN users actor ON actor.id=es.completed_by
  WHERE es.exercise_id=$1
  ORDER BY s.sort_order`,[id]);
 const summary=summarizeSidecContinuityExercise(stepResult.rows.map((row:any)=>({required:Boolean(row.required),status:row.status})));
 return {...exercise,summary,steps:stepResult.rows};
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
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const created=await client.query(`INSERT INTO sidec_continuity_exercises(
      organization_id,plan_id,scenario,status,created_by
     ) VALUES($1,$2,$3,'IN_PROGRESS',$4) RETURNING id`,[org,plan.id,parsed.data.scenario,auth.userId]);
   const exerciseId=String(created.rows[0].id);
   await client.query(`INSERT INTO sidec_continuity_exercise_steps(exercise_id,step_id)
    SELECT $1,id FROM sidec_continuity_steps WHERE plan_id=$2 ORDER BY sort_order`,[exerciseId,plan.id]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
    VALUES($1,'sidec_continuity.exercise_start','sidec_continuity_exercise',$2,$3,$4,$5::jsonb)`,[
    auth.userId,exerciseId,request.ip,request.headers["user-agent"]??null,
    JSON.stringify({planId:plan.id,planVersion:plan.version,scenario:parsed.data.scenario})
   ]);
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
}
