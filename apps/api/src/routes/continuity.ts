import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { defaultSidecRunbookSteps, summarizeSidecContinuityExercise, validateSidecRunbookActivation } from "../lib/sidec-runbook.js";
import { buildContinuityExerciseReportPdf } from "../lib/sidec-continuity-report.js";
import { buildContinuityChangeReportPdf } from "../lib/sidec-continuity-change-report.js";
import { signSidecContinuityChangeReport,verifySidecContinuityChangeReport } from "../lib/sidec-asymmetric.js";

const phaseSchema=z.enum(["DECLARATION","COMMUNICATION","PRESERVATION","RECOVERY","VALIDATION","RETURN"]);

const runbookStepSchema=z.object({
 lineageKey:z.string().uuid().optional(),
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
 dueAt:z.coerce.date().nullable().optional(),
 riskId:z.string().uuid().nullable().optional(),
 recoveryActionId:z.string().uuid().nullable().optional(),
 recurrenceKey:z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/).nullable().optional()
});

const aarActionUpdateSchema=z.object({
 title:z.string().trim().min(3).max(240).optional(),
 description:z.string().trim().max(8000).optional(),
 priority:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).optional(),
 ownerUserId:z.string().uuid().nullable().optional(),
 dueAt:z.coerce.date().nullable().optional(),
 riskId:z.string().uuid().nullable().optional(),
 recoveryActionId:z.string().uuid().nullable().optional(),
 recurrenceKey:z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/).nullable().optional(),
 status:z.enum(["OPEN","IN_PROGRESS","DONE","CANCELLED"]).optional()
});

const aarActionEffectivenessSchema=z.object({
 effectiveness:z.enum(["EFFECTIVE","PARTIAL","INEFFECTIVE"]),
 notes:z.string().trim().min(5).max(8000)
});

const promoteRecoverySchema=z.object({
 confirm:z.literal(true),
 title:z.string().trim().min(3).max(240).optional(),
 category:z.string().trim().min(2).max(100).default("CONTINUIDADE_SIDEC"),
 responsible:z.string().trim().max(200).nullable().optional(),
 dueAt:z.coerce.date().nullable().optional(),
 notes:z.string().trim().max(5000).nullable().optional()
});

const recommendationUpdateSchema=z.object({
 status:z.enum(["ACCEPTED","IMPLEMENTED","DISMISSED"]),
 notes:z.string().trim().min(5).max(8000)
});

const changeProposalCreateSchema=z.object({
 targetPlanId:z.string().uuid(),
 proposalText:z.string().trim().min(10).max(12000)
});

const changeEvidenceSchema=z.object({
 evidenceType:z.enum(["NOTE","LINK","DOCUMENT","HASH"]),
 title:z.string().trim().min(3).max(240),
 reference:z.string().trim().min(1).max(12000),
 contentHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()
});

const changeApprovalSchema=z.object({
 decision:z.enum(["APPROVED","REJECTED"]),
 notes:z.string().trim().min(5).max(8000)
});

const changeProposalTransitionSchema=z.discriminatedUnion("status",[
 z.object({status:z.literal("APPLIED"),notes:z.string().trim().min(5).max(8000)}),
 z.object({status:z.literal("VERIFIED"),verificationExerciseId:z.string().uuid(),notes:z.string().trim().min(5).max(8000)}),
 z.object({status:z.literal("CANCELLED"),notes:z.string().trim().min(5).max(8000)})
]);

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
 const planResult=await db.query(`SELECT p.id,p.version,p.title,p.status,p.parent_plan_id AS "parentPlanId",
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
 const steps=await db.query(`SELECT s.id,s.lineage_key AS "lineageKey",s.phase,s.sort_order AS "sortOrder",s.title,s.instructions,
   s.expected_minutes AS "expectedMinutes",s.owner_user_id AS "ownerUserId",s.required,
   u.display_name AS "ownerName",u.matricula AS "ownerMatricula",u.job_title AS "ownerJobTitle"
  FROM sidec_continuity_steps s
  LEFT JOIN users u ON u.id=s.owner_user_id
  WHERE s.plan_id=$1
  ORDER BY s.sort_order`,[id]);
 return {...plan,steps:steps.rows};
}

const runbookDiffFields=[
 ["title","Título"],
 ["activationCriteria","Critérios de ativação"],
 ["recoveryStrategy","Estratégia de recuperação"],
 ["communicationPlan","Plano de comunicação"],
 ["returnToNormal","Retorno à normalidade"]
] as const;

async function buildRunbookDiff(org:string,targetPlanId:string,basePlanId?:string|null){
 const target=await loadRunbookPlan(org,targetPlanId);
 if(!target)return null;
 const resolvedBaseId=basePlanId??(target.parentPlanId?String(target.parentPlanId):null);
 const base=resolvedBaseId?await loadRunbookPlan(org,resolvedBaseId):null;
 const fields=runbookDiffFields.flatMap(([field,label])=>{
  const before=base?(base as any)[field]??null:null;
  const after=(target as any)[field]??null;
  return before===after?[]:[{field,label,before,after}];
 });
 const key=(step:any)=>String(step.lineageKey??`${String(step.phase)}:${Number(step.sortOrder)}`);
 const baseMap=new Map<string,any>();
 for(const step of base?.steps??[])baseMap.set(key(step),step);
 const targetMap=new Map<string,any>();
 for(const step of target.steps??[])targetMap.set(key(step),step);
 const keys=[...new Set([...baseMap.keys(),...targetMap.keys()])];
 const steps:any[]=[];
 for(const stepKey of keys){
  const before=baseMap.get(stepKey),after=targetMap.get(stepKey);
  if(!before&&after){
   steps.push({stepKey,changeType:"ADDED",baseStepId:null,targetStepId:after.id,phase:after.phase,sortOrder:after.sortOrder,title:after.title,changedFields:["step"]});
   continue;
  }
  if(before&&!after){
   steps.push({stepKey,changeType:"REMOVED",baseStepId:before.id,targetStepId:null,phase:before.phase,sortOrder:before.sortOrder,title:before.title,changedFields:["step"]});
   continue;
  }
  if(!before||!after)continue;
  const changedFields=["phase","sortOrder","title","instructions","expectedMinutes","ownerUserId","required"].filter(field=>{
   const left=(before as any)[field]??null,right=(after as any)[field]??null;
   return left!==right;
  });
  if(changedFields.length)steps.push({stepKey,changeType:"MODIFIED",baseStepId:before.id,targetStepId:after.id,phase:after.phase,sortOrder:after.sortOrder,title:after.title,changedFields});
 }
 steps.sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder)||String(a.stepKey).localeCompare(String(b.stepKey)));
 const summary={
  fieldsChanged:fields.length,
  stepsAdded:steps.filter(x=>x.changeType==="ADDED").length,
  stepsModified:steps.filter(x=>x.changeType==="MODIFIED").length,
  stepsRemoved:steps.filter(x=>x.changeType==="REMOVED").length,
  totalChanges:fields.length+steps.length
 };
 return {
  basePlan:base?{id:base.id,version:base.version,title:base.title}:null,
  targetPlan:{id:target.id,version:target.version,title:target.title},
  fields,steps,summary,generatedAt:new Date().toISOString()
 };
}

function exerciseResultRank(value:any){
 return value==="PASS"?3:value==="PARTIAL"?2:value==="FAIL"?1:0;
}

function exerciseEffectivenessView(exercise:any){
 if(!exercise)return null;
 return {
  id:exercise.id,planId:exercise.planId,planVersion:exercise.planVersion,planTitle:exercise.planTitle,
  result:exercise.result??null,startedAt:exercise.startedAt,completedAt:exercise.completedAt,
  summary:exercise.summary
 };
}

async function buildChangeEffectivenessSnapshot(org:string,basePlanId:string|null|undefined,verificationExerciseId:string){
 const verification=await loadExercise(org,verificationExerciseId);
 if(!verification)return null;
 let baseline:any=null;
 if(basePlanId){
  const baselineRow=await db.query(`SELECT e.id
   FROM sidec_continuity_exercises e
   JOIN sidec_continuity_aars a ON a.exercise_id=e.id AND a.organization_id=e.organization_id
   WHERE e.organization_id=$1 AND e.plan_id=$2 AND e.status='COMPLETED' AND a.status='FINAL'
   ORDER BY e.completed_at DESC NULLS LAST,e.started_at DESC LIMIT 1`,[org,basePlanId]);
  if(baselineRow.rows[0])baseline=await loadExercise(org,String(baselineRow.rows[0].id));
 }
 let outcome:"NO_BASELINE"|"IMPROVED"|"STABLE"|"REGRESSED"="NO_BASELINE";
 if(baseline){
  const baseRank=exerciseResultRank(baseline.result),verificationRank=exerciseResultRank(verification.result);
  if(verificationRank>baseRank)outcome="IMPROVED";
  else if(verificationRank<baseRank)outcome="REGRESSED";
  else{
   const baseFailed=Number(baseline.summary?.failed??0),verificationFailed=Number(verification.summary?.failed??0);
   if(verificationFailed<baseFailed)outcome="IMPROVED";
   else if(verificationFailed>baseFailed)outcome="REGRESSED";
   else outcome="STABLE";
  }
 }
 return {outcome,baseline:exerciseEffectivenessView(baseline),verification:exerciseEffectivenessView(verification),evaluatedAt:new Date().toISOString()};
}

async function loadChangeReportPayload(org:string,id:string){
 const result=await db.query(`SELECT cp.id,cp.status,cp.proposal_text AS "proposalText",cp.status_notes AS "statusNotes",
   cp.created_at AS "createdAt",cp.applied_at AS "appliedAt",cp.verified_at AS "verifiedAt",
   cp.target_plan_id AS "targetPlanId",p.version AS "targetPlanVersion",p.title AS "targetPlanTitle",
   cp.base_plan_id AS "basePlanId",bp.version AS "basePlanVersion",bp.title AS "basePlanTitle",
   cp.diff_snapshot AS "diffSnapshot",cp.effectiveness_snapshot AS "effectivenessSnapshot",
   cp.effectiveness_outcome AS "effectivenessOutcome",
   rr.recurrence_key AS "recurrenceKey",rr.title AS "recommendationTitle",rr.severity AS "recommendationSeverity",
   creator.display_name AS "createdByName",applier.display_name AS "appliedByName",verifier.display_name AS "verifiedByName",
   COALESCE((SELECT json_agg(json_build_object(
     'id',ev.id,'evidenceType',ev.evidence_type,'title',ev.title,'reference',ev.reference,
     'contentHash',ev.content_hash,'createdAt',ev.created_at,'createdByName',eu.display_name
   ) ORDER BY ev.created_at)
    FROM sidec_continuity_change_evidence ev
    LEFT JOIN users eu ON eu.id=ev.created_by
    WHERE ev.proposal_id=cp.id),'[]'::json) AS evidence,
   COALESCE((SELECT json_agg(json_build_object(
     'id',ca.id,'decision',ca.decision,'notes',ca.notes,'decidedAt',ca.decided_at,
     'decidedById',ca.decided_by,'decidedByName',cu.display_name
   ) ORDER BY ca.decided_at)
    FROM sidec_continuity_change_approvals ca
    LEFT JOIN users cu ON cu.id=ca.decided_by
    WHERE ca.proposal_id=cp.id),'[]'::json) AS approvals
  FROM sidec_continuity_change_proposals cp
  JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
  JOIN sidec_continuity_plans p ON p.id=cp.target_plan_id
  LEFT JOIN sidec_continuity_plans bp ON bp.id=cp.base_plan_id
  LEFT JOIN users creator ON creator.id=cp.created_by
  LEFT JOIN users applier ON applier.id=cp.applied_by
  LEFT JOIN users verifier ON verifier.id=cp.verified_by
  WHERE cp.id=$1 AND cp.organization_id=$2`,[id,org]);
 const proposal=result.rows[0] as any;
 if(!proposal)return null;
 const diff=proposal.diffSnapshot??await buildRunbookDiff(org,String(proposal.targetPlanId),proposal.basePlanId?String(proposal.basePlanId):null);
 const effectiveness=proposal.effectivenessSnapshot??null;
 const organization=await db.query(`SELECT name FROM organizations WHERE id=$1`,[org]);
 return {organizationName:String(organization.rows[0]?.name??"Organização"),proposal,diff,effectiveness};
}

async function operators(org:string){
 const r=await db.query(`SELECT id,matricula,display_name AS "displayName",job_title AS "jobTitle",department
  FROM users WHERE organization_id=$1 ORDER BY display_name,matricula`,[org]);
 return r.rows;
}

async function validateActionReferences(org:string,input:{riskId?:string|null;recoveryActionId?:string|null}){
 if(input.riskId){
  const risk=await db.query(`SELECT id FROM risk_registers WHERE id=$1 AND organization_id=$2`,[input.riskId,org]);
  if(!risk.rows[0])throw Object.assign(new Error("Risco fora da organização ou inexistente."),{statusCode:400,code:"INVALID_RISK_REFERENCE"});
 }
 if(input.recoveryActionId){
  const recovery=await db.query(`SELECT id FROM recovery_actions WHERE id=$1 AND organization_id=$2`,[input.recoveryActionId,org]);
  if(!recovery.rows[0])throw Object.assign(new Error("Ação de recuperação fora da organização ou inexistente."),{statusCode:400,code:"INVALID_RECOVERY_REFERENCE"});
 }
}

async function refreshRunbookRecommendations(org:string){
 const recurring=await db.query(`SELECT l.recurrence_key AS "recurrenceKey",
   count(*)::int AS occurrences,min(l.created_at) AS "firstSeenAt",max(l.created_at) AS "lastSeenAt",
   (array_agg(l.category ORDER BY l.created_at DESC))[1] AS category,
   (array_agg(l.title ORDER BY l.created_at DESC))[1] AS "latestTitle",
   (array_agg(l.id ORDER BY l.created_at DESC))[1] AS "latestLessonId",
   max(CASE l.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END)::int AS "severityRank"
  FROM sidec_continuity_lessons l
  JOIN sidec_continuity_aars a ON a.id=l.aar_id
  WHERE a.organization_id=$1 AND a.status='FINAL'
  GROUP BY l.recurrence_key
  HAVING count(*)>=2`,[org]);
 const severity=(rank:number)=>rank>=4?"CRITICAL":rank===3?"HIGH":rank===2?"MEDIUM":"LOW";
 for(const row of recurring.rows as Array<any>){
  const active=await db.query(`SELECT id FROM sidec_continuity_runbook_recommendations
    WHERE organization_id=$1 AND recurrence_key=$2 AND status IN ('OPEN','ACCEPTED')
    ORDER BY created_at DESC LIMIT 1`,[org,row.recurrenceKey]);
  const rationale=`A lição ${row.recurrenceKey} apareceu ${row.occurrences} vezes em AARs finalizados. Recomenda-se revisão humana do runbook para verificar controles, responsáveis e instruções relacionados.`;
  if(active.rows[0]){
   await db.query(`UPDATE sidec_continuity_runbook_recommendations
     SET category=$1,severity=$2,title=$3,rationale=$4,occurrences=$5,first_seen_at=$6,last_seen_at=$7,
       latest_lesson_id=$8,updated_at=now()
     WHERE id=$9`,[
      row.category,severity(Number(row.severityRank)),`Revisar runbook: ${row.latestTitle}`,rationale,
      row.occurrences,row.firstSeenAt,row.lastSeenAt,row.latestLessonId,active.rows[0].id
    ]);
   continue;
  }
  const resolved=await db.query(`SELECT last_seen_at AS "lastSeenAt" FROM sidec_continuity_runbook_recommendations
    WHERE organization_id=$1 AND recurrence_key=$2 AND status IN ('IMPLEMENTED','DISMISSED')
    ORDER BY created_at DESC LIMIT 1`,[org,row.recurrenceKey]);
  const resolvedSeen=resolved.rows[0]?.lastSeenAt?new Date(resolved.rows[0].lastSeenAt).getTime():0;
  if(resolvedSeen>=new Date(row.lastSeenAt).getTime())continue;
  await db.query(`INSERT INTO sidec_continuity_runbook_recommendations(
    organization_id,recurrence_key,category,severity,title,rationale,occurrences,first_seen_at,last_seen_at,latest_lesson_id
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[
    org,row.recurrenceKey,row.category,severity(Number(row.severityRank)),`Revisar runbook: ${row.latestTitle}`,
    rationale,row.occurrences,row.firstSeenAt,row.lastSeenAt,row.latestLessonId
   ]);
 }
 return {evaluated:recurring.rows.length};
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
  const [actions,lessons]=await Promise.all([
   db.query(`SELECT ai.id,ai.title,ai.description,ai.priority,ai.owner_user_id AS "ownerUserId",
     owner.display_name AS "ownerName",owner.matricula AS "ownerMatricula",ai.due_at AS "dueAt",ai.status,
     ai.completed_at AS "completedAt",ai.created_at AS "createdAt",ai.updated_at AS "updatedAt",
     ai.risk_id AS "riskId",r.code AS "riskCode",r.title AS "riskTitle",
     ai.recovery_action_id AS "recoveryActionId",ra.title AS "recoveryActionTitle",ra.status AS "recoveryActionStatus",
     ai.recurrence_key AS "recurrenceKey",ai.effectiveness,ai.effectiveness_notes AS "effectivenessNotes",
     ai.effectiveness_evaluated_at AS "effectivenessEvaluatedAt",evaluator.display_name AS "effectivenessEvaluatedByName"
    FROM sidec_continuity_action_items ai
    LEFT JOIN users owner ON owner.id=ai.owner_user_id
    LEFT JOIN risk_registers r ON r.id=ai.risk_id
    LEFT JOIN recovery_actions ra ON ra.id=ai.recovery_action_id
    LEFT JOIN users evaluator ON evaluator.id=ai.effectiveness_evaluated_by
    WHERE ai.aar_id=$1
    ORDER BY CASE ai.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
     ai.due_at NULLS LAST,ai.created_at`,[aarRow.id]),
   db.query(`SELECT id,category,recurrence_key AS "recurrenceKey",title,observation,severity,created_at AS "createdAt"
    FROM sidec_continuity_lessons WHERE aar_id=$1 ORDER BY created_at`,[aarRow.id])
  ]);
  aar={...aarRow,actions:actions.rows,lessons:lessons.rows};
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
  const revisions=await db.query(`SELECT id,version,title,status,parent_plan_id AS "parentPlanId",created_at AS "createdAt",
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
   ?(await db.query(`SELECT lineage_key AS "lineageKey",phase,sort_order AS "sortOrder",title,instructions,expected_minutes AS "expectedMinutes",
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
      organization_id,version,title,status,activation_criteria,recovery_strategy,communication_plan,return_to_normal,parent_plan_id,created_by
     ) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9)
     RETURNING id`,[org,version,fields.title,fields.activationCriteria,fields.recoveryStrategy,fields.communicationPlan,fields.returnToNormal,active?.id??null,auth.userId]);
   const id=String(created.rows[0].id);
   for(const step of sourceSteps){
    await client.query(`INSERT INTO sidec_continuity_steps(
      plan_id,lineage_key,phase,sort_order,title,instructions,expected_minutes,owner_user_id,required
     ) VALUES($1,COALESCE($2::uuid,gen_random_uuid()),$3,$4,$5,$6,$7,$8,$9)`,[
      id,step.lineageKey??null,step.phase,Number(step.sortOrder),step.title,step.instructions,Number(step.expectedMinutes),
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
   const lineageKeys=parsed.data.steps.map(step=>step.lineageKey).filter((value):value is string=>Boolean(value));
   if(new Set(lineageKeys).size!==lineageKeys.length)throw Object.assign(new Error("Identidade de etapa duplicada no rascunho."),{statusCode:400,code:"DUPLICATE_STEP_LINEAGE"});
   if(lineageKeys.length){
    const allowed=await client.query(`SELECT DISTINCT lineage_key::text AS key FROM sidec_continuity_steps
      WHERE plan_id=$1 OR plan_id=$2`,[id,before.parentPlanId??id]);
    const allowedSet=new Set(allowed.rows.map((row:any)=>String(row.key)));
    const invalid=lineageKeys.filter(value=>!allowedSet.has(value));
    if(invalid.length)throw Object.assign(new Error("Identidade de etapa não pertence à linhagem deste runbook."),{statusCode:400,code:"INVALID_STEP_LINEAGE"});
   }
   await client.query("DELETE FROM sidec_continuity_steps WHERE plan_id=$1",[id]);
   for(const step of parsed.data.steps){
    await client.query(`INSERT INTO sidec_continuity_steps(
      plan_id,lineage_key,phase,sort_order,title,instructions,expected_minutes,owner_user_id,required
     ) VALUES($1,COALESCE($2::uuid,gen_random_uuid()),$3,$4,$5,$6,$7,$8,$9)`,[
      id,step.lineageKey??null,step.phase,step.sortOrder,step.title,step.instructions,step.expectedMinutes,step.ownerUserId??null,step.required
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
    if(base.getTime()>now.getTime())base.setUTCDate(base.getUTCDate()+Number(schedule.intervalDays));
    else while(base.getTime()<=now.getTime())base.setUTCDate(base.getUTCDate()+Number(schedule.intervalDays));
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
  await validateActionReferences(org,{riskId:parsed.data.riskId,recoveryActionId:parsed.data.recoveryActionId});
  const aar=await db.query(`SELECT a.id,a.status FROM sidec_continuity_aars a JOIN sidec_continuity_exercises e ON e.id=a.exercise_id WHERE a.exercise_id=$1 AND a.organization_id=$2 AND e.status='COMPLETED'`,[id,org]);
  if(!aar.rows[0])return reply.code(409).send({error:"AAR_DRAFT_REQUIRED"});
  if(aar.rows[0].status!=="DRAFT")return reply.code(409).send({error:"AAR_IMMUTABLE"});
  const created=await db.query(`INSERT INTO sidec_continuity_action_items(
    aar_id,title,description,priority,owner_user_id,due_at,risk_id,recovery_action_id,recurrence_key
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   RETURNING id,title,description,priority,owner_user_id AS "ownerUserId",due_at AS "dueAt",status,
    risk_id AS "riskId",recovery_action_id AS "recoveryActionId",recurrence_key AS "recurrenceKey",effectiveness,created_at AS "createdAt"`,[
    aar.rows[0].id,parsed.data.title,parsed.data.description,parsed.data.priority,parsed.data.ownerUserId??null,
    parsed.data.dueAt??null,parsed.data.riskId??null,parsed.data.recoveryActionId??null,parsed.data.recurrenceKey??null
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata) VALUES($1,'sidec_continuity.aar_action_create','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0]),JSON.stringify({exerciseId:id})]);
  return reply.code(201).send(created.rows[0]);
 });

 app.patch("/api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);const {exerciseId,actionId}=request.params as {exerciseId:string;actionId:string};
  const parsed=aarActionUpdateSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  if(parsed.data.ownerUserId){const owner=await db.query(`SELECT 1 FROM users WHERE id=$1 AND organization_id=$2`,[parsed.data.ownerUserId,org]);if(!owner.rows[0])return reply.code(400).send({error:"OWNER_OUTSIDE_ORGANIZATION"});}
  await validateActionReferences(org,{riskId:parsed.data.riskId,recoveryActionId:parsed.data.recoveryActionId});
  const current=await db.query(`SELECT ai.*,a.status AS aar_status FROM sidec_continuity_action_items ai JOIN sidec_continuity_aars a ON a.id=ai.aar_id WHERE ai.id=$1 AND a.exercise_id=$2 AND a.organization_id=$3`,[actionId,exerciseId,org]);
  const row=current.rows[0] as any;if(!row)return reply.code(404).send({error:"ACTION_NOT_FOUND"});
  const contentChange=parsed.data.title!==undefined||parsed.data.description!==undefined||parsed.data.priority!==undefined||parsed.data.ownerUserId!==undefined||parsed.data.dueAt!==undefined||parsed.data.riskId!==undefined||parsed.data.recoveryActionId!==undefined||parsed.data.recurrenceKey!==undefined;
  if(row.aar_status==="FINAL"&&contentChange)return reply.code(409).send({error:"AAR_ACTION_CONTENT_IMMUTABLE"});
  const nextStatus=parsed.data.status??row.status;const completedAt=nextStatus==="DONE"?(row.completed_at??new Date()):null;
  const updated=await db.query(`UPDATE sidec_continuity_action_items SET
    title=$1,description=$2,priority=$3,owner_user_id=$4,due_at=$5,risk_id=$6,recovery_action_id=$7,
    recurrence_key=$8,status=$9,completed_at=$10,updated_at=now()
    WHERE id=$11
    RETURNING id,title,description,priority,owner_user_id AS "ownerUserId",due_at AS "dueAt",
      risk_id AS "riskId",recovery_action_id AS "recoveryActionId",recurrence_key AS "recurrenceKey",
      status,completed_at AS "completedAt",effectiveness,updated_at AS "updatedAt"`,[
    parsed.data.title??row.title,parsed.data.description??row.description,parsed.data.priority??row.priority,
    parsed.data.ownerUserId===undefined?row.owner_user_id:parsed.data.ownerUserId,
    parsed.data.dueAt===undefined?row.due_at:parsed.data.dueAt,
    parsed.data.riskId===undefined?row.risk_id:parsed.data.riskId,
    parsed.data.recoveryActionId===undefined?row.recovery_action_id:parsed.data.recoveryActionId,
    parsed.data.recurrenceKey===undefined?row.recurrence_key:parsed.data.recurrenceKey,
    nextStatus,completedAt,actionId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata) VALUES($1,'sidec_continuity.aar_action_update','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[auth.userId,actionId,request.ip,request.headers["user-agent"]??null,JSON.stringify(row),JSON.stringify(updated.rows[0]),JSON.stringify({exerciseId})]);
  return updated.rows[0];
 });

 app.get("/api/v1/sidec/continuity/action-references",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const [risks,recoveryActions]=await Promise.all([
   db.query(`SELECT id,code,title,category,status,probability,impact FROM risk_registers
    WHERE organization_id=$1 ORDER BY (probability*impact) DESC,created_at DESC LIMIT 200`,[org]),
   db.query(`SELECT id,title,category,status,responsible,due_at AS "dueAt" FROM recovery_actions
    WHERE organization_id=$1 ORDER BY CASE status WHEN 'DONE' THEN 2 ELSE 1 END,due_at NULLS LAST,created_at DESC LIMIT 200`,[org])
  ]);
  return {risks:risks.rows,recoveryActions:recoveryActions.rows};
 });

 app.get("/api/v1/sidec/continuity/actions/metrics",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const summary=await db.query(`SELECT
    count(*)::int AS total,
    count(*) FILTER(WHERE ai.status='DONE')::int AS done,
    count(*) FILTER(WHERE ai.status IN ('OPEN','IN_PROGRESS') AND ai.due_at IS NOT NULL AND ai.due_at<now())::int AS overdue,
    count(*) FILTER(WHERE ai.risk_id IS NOT NULL)::int AS "linkedRisks",
    count(*) FILTER(WHERE ai.recovery_action_id IS NOT NULL)::int AS "linkedRecoveryActions",
    round(avg(EXTRACT(EPOCH FROM (ai.completed_at-ai.created_at))/3600.0) FILTER(WHERE ai.completed_at IS NOT NULL)::numeric,1) AS "avgCompletionHours",
    round((100.0*count(*) FILTER(WHERE ai.status='DONE' AND ai.due_at IS NOT NULL AND ai.completed_at<=ai.due_at)
      /NULLIF(count(*) FILTER(WHERE ai.status='DONE' AND ai.due_at IS NOT NULL),0))::numeric,1) AS "onTimePct",
    count(*) FILTER(WHERE ai.effectiveness='EFFECTIVE')::int AS effective,
    count(*) FILTER(WHERE ai.effectiveness='PARTIAL')::int AS partial,
    count(*) FILTER(WHERE ai.effectiveness='INEFFECTIVE')::int AS ineffective,
    count(*) FILTER(WHERE ai.status='DONE' AND ai.effectiveness='NOT_EVALUATED')::int AS "awaitingEffectiveness"
   FROM sidec_continuity_action_items ai
   JOIN sidec_continuity_aars a ON a.id=ai.aar_id
   WHERE a.organization_id=$1`,[org]);
  const [byPriority,byRecurrenceKey]=await Promise.all([
   db.query(`SELECT ai.priority,count(*)::int AS total,
    count(*) FILTER(WHERE ai.status='DONE')::int AS done,
    round(avg(EXTRACT(EPOCH FROM (ai.completed_at-ai.created_at))/3600.0) FILTER(WHERE ai.completed_at IS NOT NULL)::numeric,1) AS "avgCompletionHours"
   FROM sidec_continuity_action_items ai JOIN sidec_continuity_aars a ON a.id=ai.aar_id
   WHERE a.organization_id=$1 GROUP BY ai.priority
   ORDER BY CASE ai.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END`,[org]),
   db.query(`SELECT ai.recurrence_key AS "recurrenceKey",count(*)::int AS actions,
    count(DISTINCT a.exercise_id)::int AS exercises,
    count(*) FILTER(WHERE ai.effectiveness='EFFECTIVE')::int AS effective,
    count(*) FILTER(WHERE ai.effectiveness='PARTIAL')::int AS partial,
    count(*) FILTER(WHERE ai.effectiveness='INEFFECTIVE')::int AS ineffective,
    count(*) FILTER(WHERE ai.status='DONE' AND ai.effectiveness='NOT_EVALUATED')::int AS "awaitingEffectiveness",
    min(e.started_at) AS "firstExerciseAt",max(e.started_at) AS "lastExerciseAt"
   FROM sidec_continuity_action_items ai
   JOIN sidec_continuity_aars a ON a.id=ai.aar_id
   JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
   WHERE a.organization_id=$1 AND ai.recurrence_key IS NOT NULL
   GROUP BY ai.recurrence_key
   ORDER BY count(DISTINCT a.exercise_id) DESC,max(e.started_at) DESC`,[org])
  ]);
  return {summary:summary.rows[0],byPriority:byPriority.rows,byRecurrenceKey:byRecurrenceKey.rows};
 });

 app.get("/api/v1/sidec/continuity/actions/effectiveness-history",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const r=await db.query(`SELECT ai.recurrence_key AS "recurrenceKey",e.id AS "exerciseId",p.version AS "planVersion",
    e.started_at AS "startedAt",e.completed_at AS "completedAt",ai.id AS "actionId",ai.title,ai.status,ai.effectiveness,
    ai.effectiveness_notes AS "effectivenessNotes",ai.effectiveness_evaluated_at AS "effectivenessEvaluatedAt"
   FROM sidec_continuity_action_items ai
   JOIN sidec_continuity_aars a ON a.id=ai.aar_id
   JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
   JOIN sidec_continuity_plans p ON p.id=e.plan_id
   WHERE a.organization_id=$1 AND ai.recurrence_key IS NOT NULL
   ORDER BY ai.recurrence_key,e.started_at,ai.created_at`,[org]);
  const groups=new Map<string,any[]>();
  for(const row of r.rows as Array<any>){
   const key=String(row.recurrenceKey),list=groups.get(key)??[];list.push(row);groups.set(key,list);
  }
  return {items:[...groups.entries()].map(([recurrenceKey,history])=>({recurrenceKey,history}))};
 });

 app.get("/api/v1/sidec/continuity/runbook/change-metrics",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const summary=await db.query(`SELECT
    count(*)::int AS total,
    count(*) FILTER(WHERE cp.status='PROPOSED')::int AS proposed,
    count(*) FILTER(WHERE cp.status='APPLIED')::int AS applied,
    count(*) FILTER(WHERE cp.status='VERIFIED')::int AS verified,
    count(*) FILTER(WHERE cp.status='CANCELLED')::int AS cancelled,
    count(*) FILTER(WHERE rr.severity='CRITICAL')::int AS critical,
    count(*) FILTER(WHERE seal.proposal_id IS NOT NULL)::int AS sealed,
    count(*) FILTER(WHERE cp.effectiveness_outcome='IMPROVED')::int AS improved,
    count(*) FILTER(WHERE cp.effectiveness_outcome='STABLE')::int AS stable,
    count(*) FILTER(WHERE cp.effectiveness_outcome='REGRESSED')::int AS regressed,
    count(*) FILTER(WHERE cp.effectiveness_outcome='NO_BASELINE')::int AS "noBaseline",
    round((100.0*count(*) FILTER(WHERE cp.status='VERIFIED')/NULLIF(count(*) FILTER(WHERE cp.status<>'CANCELLED'),0))::numeric,1) AS "verifiedRate",
    round((100.0*count(*) FILTER(WHERE cp.effectiveness_outcome='IMPROVED')/
      NULLIF(count(*) FILTER(WHERE cp.effectiveness_outcome IN ('IMPROVED','STABLE','REGRESSED')),0))::numeric,1) AS "improvedRate",
    round(avg(EXTRACT(EPOCH FROM (cp.applied_at-cp.created_at))/3600.0) FILTER(WHERE cp.applied_at IS NOT NULL)::numeric,1) AS "avgApplyHours",
    round(avg(EXTRACT(EPOCH FROM (cp.verified_at-cp.applied_at))/3600.0) FILTER(WHERE cp.verified_at IS NOT NULL AND cp.applied_at IS NOT NULL)::numeric,1) AS "avgVerificationHours"
   FROM sidec_continuity_change_proposals cp
   JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
   LEFT JOIN sidec_continuity_change_report_seals seal ON seal.proposal_id=cp.id
   WHERE cp.organization_id=$1`,[org]);
  const [bySeverity,byMonth]=await Promise.all([
   db.query(`SELECT rr.severity,count(*)::int AS total,
      count(*) FILTER(WHERE cp.status='VERIFIED')::int AS verified,
      count(*) FILTER(WHERE cp.effectiveness_outcome='IMPROVED')::int AS improved,
      count(*) FILTER(WHERE cp.effectiveness_outcome='REGRESSED')::int AS regressed
     FROM sidec_continuity_change_proposals cp
     JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
     WHERE cp.organization_id=$1
     GROUP BY rr.severity
     ORDER BY CASE rr.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END`,[org]),
   db.query(`SELECT to_char(date_trunc('month',cp.created_at),'YYYY-MM') AS month,count(*)::int AS total,
      count(*) FILTER(WHERE cp.status='VERIFIED')::int AS verified,
      count(*) FILTER(WHERE cp.effectiveness_outcome='IMPROVED')::int AS improved,
      count(*) FILTER(WHERE cp.effectiveness_outcome='REGRESSED')::int AS regressed
     FROM sidec_continuity_change_proposals cp
     WHERE cp.organization_id=$1 AND cp.created_at>=date_trunc('month',now())-interval '11 months'
     GROUP BY date_trunc('month',cp.created_at)
     ORDER BY date_trunc('month',cp.created_at)`,[org])
  ]);
  return {summary:summary.rows[0],bySeverity:bySeverity.rows,byMonth:byMonth.rows};
 });

 app.get("/api/v1/sidec/continuity/runbook/recommendations",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  await refreshRunbookRecommendations(org);
  const r=await db.query(`SELECT rr.id,rr.recurrence_key AS "recurrenceKey",rr.category,rr.severity,rr.title,rr.rationale,
    rr.occurrences,rr.first_seen_at AS "firstSeenAt",rr.last_seen_at AS "lastSeenAt",rr.status,
    rr.resolution_notes AS "resolutionNotes",rr.created_at AS "createdAt",rr.updated_at AS "updatedAt",
    u.display_name AS "resolvedByName"
   FROM sidec_continuity_runbook_recommendations rr
   LEFT JOIN users u ON u.id=rr.resolved_by
   WHERE rr.organization_id=$1
   ORDER BY CASE rr.status WHEN 'OPEN' THEN 1 WHEN 'ACCEPTED' THEN 2 ELSE 3 END,
    CASE rr.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
    rr.last_seen_at DESC`,[org]);
  return {items:r.rows};
 });

 app.get("/api/v1/sidec/continuity/runbook/change-proposals",{preHandler:requirePermission("sidec_continuity.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const r=await db.query(`SELECT cp.id,cp.recommendation_id AS "recommendationId",rr.recurrence_key AS "recurrenceKey",
    rr.title AS "recommendationTitle",rr.status AS "recommendationStatus",rr.severity AS "recommendationSeverity",cp.target_plan_id AS "targetPlanId",
    p.version AS "targetPlanVersion",p.title AS "targetPlanTitle",p.status AS "targetPlanStatus",
    cp.base_plan_id AS "basePlanId",bp.version AS "basePlanVersion",bp.title AS "basePlanTitle",
    cp.proposal_text AS "proposalText",cp.status,cp.status_notes AS "statusNotes",
    cp.applied_at AS "appliedAt",cp.verified_at AS "verifiedAt",cp.verification_exercise_id AS "verificationExerciseId",
    ve.result AS "verificationExerciseResult",ve.started_at AS "verificationExerciseStartedAt",
    cp.baseline_exercise_id AS "baselineExerciseId",be.result AS "baselineExerciseResult",be.started_at AS "baselineExerciseStartedAt",
    cp.diff_snapshot AS "diffSnapshot",cp.effectiveness_outcome AS "effectivenessOutcome",
    cp.effectiveness_snapshot AS "effectivenessSnapshot",
    cp.created_at AS "createdAt",cp.updated_at AS "updatedAt",cp.created_by AS "createdById",
    creator.display_name AS "createdByName",applier.display_name AS "appliedByName",verifier.display_name AS "verifiedByName",
    seal.report_hash AS "reportHash",seal.key_id AS "reportSealKeyId",seal.public_key_fingerprint AS "reportSealFingerprint",
    seal.sealed_at AS "reportSealedAt",sealer.display_name AS "reportSealedByName",
    COALESCE((SELECT json_agg(json_build_object(
      'id',ev.id,'evidenceType',ev.evidence_type,'title',ev.title,'reference',ev.reference,
      'contentHash',ev.content_hash,'createdAt',ev.created_at,'createdByName',eu.display_name
    ) ORDER BY ev.created_at)
     FROM sidec_continuity_change_evidence ev
     LEFT JOIN users eu ON eu.id=ev.created_by
     WHERE ev.proposal_id=cp.id),'[]'::json) AS evidence,
    COALESCE((SELECT json_agg(json_build_object(
      'id',ci.id,'stepKey',ci.step_key,'changeType',ci.change_type,'phase',ci.phase,'sortOrder',ci.sort_order,
      'title',ci.title,'changedFields',ci.changed_fields
    ) ORDER BY ci.sort_order,ci.change_type)
     FROM sidec_continuity_change_impacts ci WHERE ci.proposal_id=cp.id),'[]'::json) AS impacts,
    COALESCE((SELECT json_agg(json_build_object(
      'id',ca.id,'decision',ca.decision,'notes',ca.notes,'decidedAt',ca.decided_at,
      'decidedById',ca.decided_by,'decidedByName',au.display_name
    ) ORDER BY ca.decided_at)
     FROM sidec_continuity_change_approvals ca
     LEFT JOIN users au ON au.id=ca.decided_by
     WHERE ca.proposal_id=cp.id),'[]'::json) AS approvals
   FROM sidec_continuity_change_proposals cp
   JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
   JOIN sidec_continuity_plans p ON p.id=cp.target_plan_id
   LEFT JOIN sidec_continuity_plans bp ON bp.id=cp.base_plan_id
   LEFT JOIN sidec_continuity_exercises ve ON ve.id=cp.verification_exercise_id
   LEFT JOIN sidec_continuity_exercises be ON be.id=cp.baseline_exercise_id
   LEFT JOIN users creator ON creator.id=cp.created_by
   LEFT JOIN users applier ON applier.id=cp.applied_by
   LEFT JOIN users verifier ON verifier.id=cp.verified_by
   LEFT JOIN sidec_continuity_change_report_seals seal ON seal.proposal_id=cp.id
   LEFT JOIN users sealer ON sealer.id=seal.sealed_by
   WHERE cp.organization_id=$1
   ORDER BY CASE cp.status WHEN 'PROPOSED' THEN 1 WHEN 'APPLIED' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END,cp.created_at DESC`,[org]);
  const items=[];
  for(const row of r.rows as Array<any>){
   const diff=row.diffSnapshot??await buildRunbookDiff(org,String(row.targetPlanId),row.basePlanId?String(row.basePlanId):null);
   const approvals=Array.isArray(row.approvals)?row.approvals:[];
   const approvedCount=approvals.filter((item:any)=>item.decision==="APPROVED").length;
   const rejectedCount=approvals.filter((item:any)=>item.decision==="REJECTED").length;
   items.push({...row,approvedCount,rejectedCount,criticalApprovalSatisfied:row.recommendationSeverity!=="CRITICAL"||(approvedCount>=2&&rejectedCount===0),
    reportSealed:Boolean(row.reportHash),diffSummary:diff?.summary??{fieldsChanged:0,stepsAdded:0,stepsModified:0,stepsRemoved:0,totalChanges:0}});

  }
  return {items};
 });

 app.post("/api/v1/sidec/continuity/runbook/recommendations/:id/change-proposal",{preHandler:requirePermission("sidec_continuity_improvement.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=changeProposalCreateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const recommendation=await db.query(`SELECT id,status,title,recurrence_key AS "recurrenceKey"
    FROM sidec_continuity_runbook_recommendations WHERE id=$1 AND organization_id=$2`,[id,org]);
  const rec=recommendation.rows[0] as any;
  if(!rec)return reply.code(404).send({error:"RECOMMENDATION_NOT_FOUND"});
  if(rec.status!=="ACCEPTED")return reply.code(409).send({error:"ACCEPTED_RECOMMENDATION_REQUIRED",status:rec.status});
  const plan=await db.query(`SELECT id,version,title,status,parent_plan_id AS "basePlanId" FROM sidec_continuity_plans
    WHERE id=$1 AND organization_id=$2`,[parsed.data.targetPlanId,org]);
  const target=plan.rows[0] as any;
  if(!target)return reply.code(404).send({error:"TARGET_PLAN_NOT_FOUND"});
  if(target.status!=="DRAFT")return reply.code(409).send({error:"DRAFT_TARGET_PLAN_REQUIRED",status:target.status});
  const existing=await db.query(`SELECT id,status FROM sidec_continuity_change_proposals
    WHERE recommendation_id=$1 AND organization_id=$2 AND status<>'CANCELLED' LIMIT 1`,[id,org]);
  if(existing.rows[0])return reply.code(409).send({error:"ACTIVE_CHANGE_PROPOSAL_EXISTS",proposalId:existing.rows[0].id,status:existing.rows[0].status});
  const created=await db.query(`INSERT INTO sidec_continuity_change_proposals(
     organization_id,recommendation_id,target_plan_id,base_plan_id,proposal_text,created_by
    ) VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id,recommendation_id AS "recommendationId",target_plan_id AS "targetPlanId",base_plan_id AS "basePlanId",
      proposal_text AS "proposalText",status,created_at AS "createdAt"`,[org,id,target.id,target.basePlanId??null,parsed.data.proposalText,auth.userId]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'sidec_continuity.change_proposal_create','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0]),
    JSON.stringify({recommendationId:id,targetPlanId:target.id,targetPlanVersion:target.version})
  ]);
  return reply.code(201).send(created.rows[0]);
 });

 app.post("/api/v1/sidec/continuity/runbook/change-proposals/:id/evidence",{preHandler:requirePermission("sidec_continuity_improvement.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=changeEvidenceSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const proposal=await db.query(`SELECT id,status FROM sidec_continuity_change_proposals WHERE id=$1 AND organization_id=$2`,[id,org]);
  const row=proposal.rows[0] as any;
  if(!row)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});
  if(row.status==="VERIFIED"||row.status==="CANCELLED")return reply.code(409).send({error:"PROPOSAL_IMMUTABLE",status:row.status});
  const created=await db.query(`INSERT INTO sidec_continuity_change_evidence(
     proposal_id,evidence_type,title,reference,content_hash,created_by
    ) VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id,evidence_type AS "evidenceType",title,reference,content_hash AS "contentHash",created_at AS "createdAt"`,[
    id,parsed.data.evidenceType,parsed.data.title,parsed.data.reference,parsed.data.contentHash??null,auth.userId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'sidec_continuity.change_evidence_create','sidec_continuity_change_evidence',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,created.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(created.rows[0]),JSON.stringify({proposalId:id})
  ]);
  return reply.code(201).send(created.rows[0]);
 });

 app.post("/api/v1/sidec/continuity/runbook/change-proposals/:id/approval",{preHandler:requirePermission("sidec_continuity_change.approve")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=changeApprovalSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const current=await db.query(`SELECT cp.id,cp.status,cp.created_by AS "createdById",rr.severity
    FROM sidec_continuity_change_proposals cp
    JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
    WHERE cp.id=$1 AND cp.organization_id=$2`,[id,org]);
  const proposal=current.rows[0] as any;
  if(!proposal)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});
  if(proposal.severity!=="CRITICAL")return reply.code(409).send({error:"CRITICAL_PROPOSAL_REQUIRED"});
  if(proposal.status!=="PROPOSED")return reply.code(409).send({error:"PROPOSED_STATUS_REQUIRED",status:proposal.status});
  if(String(proposal.createdById)===String(auth.userId))return reply.code(409).send({error:"CREATOR_CANNOT_APPROVE_CRITICAL_CHANGE"});
  const decision=await db.query(`INSERT INTO sidec_continuity_change_approvals(proposal_id,decision,notes,decided_by)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(proposal_id,decided_by) DO UPDATE
      SET decision=EXCLUDED.decision,notes=EXCLUDED.notes,decided_at=now(),updated_at=now()
    RETURNING id,decision,notes,decided_by AS "decidedById",decided_at AS "decidedAt"`,[
     id,parsed.data.decision,parsed.data.notes,auth.userId
    ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'sidec_continuity.change_approval','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
     auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(decision.rows[0]),JSON.stringify({decision:parsed.data.decision})
    ]);
  return decision.rows[0];
 });

 app.patch("/api/v1/sidec/continuity/runbook/change-proposals/:id",{preHandler:requirePermission("sidec_continuity_improvement.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=changeProposalTransitionSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const currentResult=await db.query(`SELECT cp.*,rr.status AS recommendation_status,rr.severity AS recommendation_severity,p.status AS plan_status,p.activated_at,
    p.version AS plan_version,rr.id AS recommendation_id_value
   FROM sidec_continuity_change_proposals cp
   JOIN sidec_continuity_runbook_recommendations rr ON rr.id=cp.recommendation_id
   JOIN sidec_continuity_plans p ON p.id=cp.target_plan_id
   WHERE cp.id=$1 AND cp.organization_id=$2`,[id,org]);
  const current=currentResult.rows[0] as any;
  if(!current)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});

  if(parsed.data.status==="CANCELLED"){
   if(current.status!=="PROPOSED")return reply.code(409).send({error:"PROPOSED_STATUS_REQUIRED",status:current.status});
   const updated=await db.query(`UPDATE sidec_continuity_change_proposals
     SET status='CANCELLED',status_notes=$1,updated_at=now()
     WHERE id=$2 AND organization_id=$3
     RETURNING id,status,status_notes AS "statusNotes",updated_at AS "updatedAt"`,[parsed.data.notes,id,org]);
   await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
     VALUES($1,'sidec_continuity.change_proposal_cancel','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
     auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(current),JSON.stringify(updated.rows[0])
   ]);
   return updated.rows[0];
  }

  if(parsed.data.status==="APPLIED"){
   if(current.status!=="PROPOSED")return reply.code(409).send({error:"PROPOSED_STATUS_REQUIRED",status:current.status});
   if(current.recommendation_status!=="ACCEPTED")return reply.code(409).send({error:"ACCEPTED_RECOMMENDATION_REQUIRED",status:current.recommendation_status});
   if(!current.activated_at||!["ACTIVE","RETIRED"].includes(String(current.plan_status))){
    return reply.code(409).send({error:"ACTIVATED_TARGET_PLAN_REQUIRED",status:current.plan_status});
   }
   const evidence=await db.query(`SELECT count(*)::int AS count FROM sidec_continuity_change_evidence WHERE proposal_id=$1`,[id]);
   if(Number(evidence.rows[0]?.count??0)<1)return reply.code(409).send({error:"CHANGE_EVIDENCE_REQUIRED"});
   if(current.recommendation_severity==="CRITICAL"){
    const approvalState=await db.query(`SELECT
      count(*) FILTER(WHERE decision='APPROVED' AND decided_by<>$2)::int AS approved,
      count(*) FILTER(WHERE decision='REJECTED')::int AS rejected
     FROM sidec_continuity_change_approvals WHERE proposal_id=$1`,[id,current.created_by]);
    const approved=Number(approvalState.rows[0]?.approved??0),rejected=Number(approvalState.rows[0]?.rejected??0);
    if(rejected>0)return reply.code(409).send({error:"CRITICAL_CHANGE_REJECTED",rejected});
    if(approved<2)return reply.code(409).send({error:"CRITICAL_CHANGE_DUAL_APPROVAL_REQUIRED",approved,required:2});
   }
   const diff=await buildRunbookDiff(org,String(current.target_plan_id),current.base_plan_id?String(current.base_plan_id):null);
   if(!diff)return reply.code(409).send({error:"RUNBOOK_DIFF_UNAVAILABLE"});
   if(Number(diff.summary?.totalChanges??0)<1)return reply.code(409).send({error:"NO_RUNBOOK_CHANGE_DETECTED"});
   const client=await db.connect();
   try{
    await client.query("BEGIN");
    const updated=await client.query(`UPDATE sidec_continuity_change_proposals
      SET status='APPLIED',status_notes=$1,diff_snapshot=$2::jsonb,applied_by=$3,applied_at=now(),updated_at=now()
      WHERE id=$4 AND organization_id=$5
      RETURNING id,status,status_notes AS "statusNotes",diff_snapshot AS "diffSnapshot",applied_at AS "appliedAt"`,[
       parsed.data.notes,JSON.stringify(diff),auth.userId,id,org
      ]);
    await client.query("DELETE FROM sidec_continuity_change_impacts WHERE proposal_id=$1",[id]);
    for(const impact of diff.steps){
     await client.query(`INSERT INTO sidec_continuity_change_impacts(
       proposal_id,base_step_id,target_step_id,step_key,change_type,phase,sort_order,title,changed_fields
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[
       id,impact.baseStepId??null,impact.targetStepId??null,impact.stepKey,impact.changeType,
       impact.phase,impact.sortOrder,impact.title,JSON.stringify(impact.changedFields??[])
      ]);
    }
    await client.query(`UPDATE sidec_continuity_runbook_recommendations
      SET status='IMPLEMENTED',resolution_notes=$1,resolved_by=$2,resolved_at=now(),updated_at=now()
      WHERE id=$3 AND organization_id=$4 AND status='ACCEPTED'`,[parsed.data.notes,auth.userId,current.recommendation_id,org]);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
      VALUES($1,'sidec_continuity.change_proposal_apply','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
      auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(current),JSON.stringify(updated.rows[0]),
      JSON.stringify({recommendationId:current.recommendation_id,targetPlanId:current.target_plan_id,targetPlanVersion:current.plan_version,
       evidenceCount:Number(evidence.rows[0]?.count??0),diffSummary:diff.summary})
    ]);
    await client.query("COMMIT");
    return updated.rows[0];
   }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
  }

  if(current.status!=="APPLIED")return reply.code(409).send({error:"APPLIED_STATUS_REQUIRED",status:current.status});
  const exercise=await db.query(`SELECT e.id,e.plan_id AS "planId",e.status,e.result,e.completed_at AS "completedAt",a.status AS "aarStatus"
    FROM sidec_continuity_exercises e
    LEFT JOIN sidec_continuity_aars a ON a.exercise_id=e.id AND a.organization_id=e.organization_id
    WHERE e.id=$1 AND e.organization_id=$2`,[parsed.data.verificationExerciseId,org]);
  const validation=exercise.rows[0] as any;
  if(!validation)return reply.code(404).send({error:"VERIFICATION_EXERCISE_NOT_FOUND"});
  if(String(validation.planId)!==String(current.target_plan_id))return reply.code(409).send({error:"VERIFICATION_EXERCISE_WRONG_PLAN"});
  if(validation.status!=="COMPLETED")return reply.code(409).send({error:"COMPLETED_VERIFICATION_EXERCISE_REQUIRED",status:validation.status});
  if(validation.aarStatus!=="FINAL")return reply.code(409).send({error:"FINAL_AAR_REQUIRED_FOR_VERIFICATION",aarStatus:validation.aarStatus??null});
  const effectiveness=await buildChangeEffectivenessSnapshot(org,current.base_plan_id?String(current.base_plan_id):null,validation.id);
  if(!effectiveness)return reply.code(409).send({error:"EFFECTIVENESS_SNAPSHOT_UNAVAILABLE"});
  const updated=await db.query(`UPDATE sidec_continuity_change_proposals
    SET status='VERIFIED',status_notes=$1,verification_exercise_id=$2,baseline_exercise_id=$3,
      effectiveness_outcome=$4,effectiveness_snapshot=$5::jsonb,verified_by=$6,verified_at=now(),updated_at=now()
    WHERE id=$7 AND organization_id=$8
    RETURNING id,status,status_notes AS "statusNotes",verification_exercise_id AS "verificationExerciseId",
      baseline_exercise_id AS "baselineExerciseId",effectiveness_outcome AS "effectivenessOutcome",
      effectiveness_snapshot AS "effectivenessSnapshot",verified_at AS "verifiedAt"`,[
     parsed.data.notes,validation.id,effectiveness.baseline?.id??null,effectiveness.outcome,JSON.stringify(effectiveness),auth.userId,id,org
    ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
    VALUES($1,'sidec_continuity.change_proposal_verify','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(current),JSON.stringify(updated.rows[0]),
    JSON.stringify({verificationExerciseId:validation.id,result:validation.result,targetPlanId:current.target_plan_id,
     targetPlanVersion:current.plan_version,baselineExerciseId:effectiveness.baseline?.id??null,effectivenessOutcome:effectiveness.outcome})
  ]);
  return updated.rows[0];
 });

 app.get("/api/v1/sidec/continuity/runbook/change-proposals/:id/diff",{preHandler:requirePermission("sidec_continuity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const current=await db.query(`SELECT id,target_plan_id AS "targetPlanId",base_plan_id AS "basePlanId",diff_snapshot AS "diffSnapshot"
    FROM sidec_continuity_change_proposals WHERE id=$1 AND organization_id=$2`,[id,org]);
  const row=current.rows[0] as any;if(!row)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});
  const diff=row.diffSnapshot??await buildRunbookDiff(org,String(row.targetPlanId),row.basePlanId?String(row.basePlanId):null);
  if(!diff)return reply.code(409).send({error:"RUNBOOK_DIFF_UNAVAILABLE"});
  return diff;
 });

 app.get("/api/v1/sidec/continuity/runbook/change-proposals/:id/report.pdf",{preHandler:requirePermission("sidec_continuity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const sealed=await db.query(`SELECT report_hash AS "reportHash",report_bytes AS "reportBytes"
    FROM sidec_continuity_change_report_seals WHERE proposal_id=$1 AND organization_id=$2`,[id,org]);
  if(sealed.rows[0]){
   const bytes=sealed.rows[0].reportBytes as Buffer;
   return reply.type("application/pdf")
    .header("Content-Disposition",`attachment; filename="SIGDEC-continuity-change-${id}-sealed.pdf"`)
    .header("Content-Length",String(bytes.length))
    .header("ETag",String(sealed.rows[0].reportHash))
    .header("X-SIGDEC-Report-Sealed","true")
    .send(bytes);
  }
  const payload=await loadChangeReportPayload(org,id);
  if(!payload)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});
  const pdf=await buildContinuityChangeReportPdf(payload);
  return reply.type("application/pdf").header("Content-Disposition",`attachment; filename="SIGDEC-continuity-change-${id}.pdf"`).header("Content-Length",String(pdf.length)).send(pdf);
 });

 app.post("/api/v1/sidec/continuity/runbook/change-proposals/:id/report/seal",{preHandler:requirePermission("sidec_continuity_change.seal")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const existing=await db.query(`SELECT proposal_id AS "proposalId",report_hash AS "reportHash",key_id AS "keyId",
    public_key_fingerprint AS "publicKeyFingerprint",sealed_at AS "sealedAt"
    FROM sidec_continuity_change_report_seals WHERE proposal_id=$1 AND organization_id=$2`,[id,org]);
  if(existing.rows[0])return existing.rows[0];
  const payload=await loadChangeReportPayload(org,id);
  if(!payload)return reply.code(404).send({error:"PROPOSAL_NOT_FOUND"});
  if(payload.proposal.status!=="VERIFIED")return reply.code(409).send({error:"VERIFIED_PROPOSAL_REQUIRED",status:payload.proposal.status});
  const pdf=await buildContinuityChangeReportPdf(payload);
  const reportHash=createHash("sha256").update(pdf).digest("hex");
  const sealedAt=new Date().toISOString();
  const proof=signSidecContinuityChangeReport({
   reportHash,proposalId:id,targetPlanId:String(payload.proposal.targetPlanId),sealedAt
  });
  const inserted=await db.query(`INSERT INTO sidec_continuity_change_report_seals(
     proposal_id,organization_id,report_hash,report_bytes,algorithm,key_id,signature,public_key,public_key_fingerprint,sealed_by,sealed_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING proposal_id AS "proposalId",report_hash AS "reportHash",algorithm,key_id AS "keyId",
      public_key_fingerprint AS "publicKeyFingerprint",sealed_at AS "sealedAt"`,[
     id,org,reportHash,pdf,proof.algorithm,proof.keyId,proof.signature,proof.publicKey,proof.publicKeyFingerprint,auth.userId,sealedAt
    ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
    VALUES($1,'sidec_continuity.change_report_seal','sidec_continuity_change_proposal',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
     auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(inserted.rows[0]),
     JSON.stringify({reportHash,algorithm:proof.algorithm,keyId:proof.keyId})
    ]);
  return reply.code(201).send({...inserted.rows[0],valid:true});
 });

 app.get("/api/v1/sidec/continuity/runbook/change-proposals/:id/report/seal",{preHandler:requirePermission("sidec_continuity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const seal=await db.query(`SELECT s.proposal_id AS "proposalId",s.report_hash AS "reportHash",s.report_bytes AS "reportBytes",
    s.algorithm,s.key_id AS "keyId",s.signature,s.public_key AS "publicKey",s.public_key_fingerprint AS "publicKeyFingerprint",
    s.sealed_at AS "sealedAt",cp.target_plan_id AS "targetPlanId",u.display_name AS "sealedByName"
   FROM sidec_continuity_change_report_seals s
   JOIN sidec_continuity_change_proposals cp ON cp.id=s.proposal_id AND cp.organization_id=s.organization_id
   LEFT JOIN users u ON u.id=s.sealed_by
   WHERE s.proposal_id=$1 AND s.organization_id=$2`,[id,org]);
  const row=seal.rows[0] as any;if(!row)return reply.code(404).send({error:"REPORT_NOT_SEALED"});
  const observedHash=createHash("sha256").update(row.reportBytes as Buffer).digest("hex");
  const hashValid=observedHash===row.reportHash;
  const signatureValid=verifySidecContinuityChangeReport({
   reportHash:String(row.reportHash),proposalId:id,targetPlanId:String(row.targetPlanId),
   sealedAt:new Date(row.sealedAt).toISOString(),signature:String(row.signature),
   publicKey:String(row.publicKey),publicKeyFingerprint:String(row.publicKeyFingerprint)
  });
  return {
   proposalId:id,algorithm:row.algorithm,keyId:row.keyId,reportHash:row.reportHash,observedHash,
   publicKeyFingerprint:row.publicKeyFingerprint,sealedAt:row.sealedAt,sealedByName:row.sealedByName,
   hashValid,signatureValid,valid:hashValid&&signatureValid
  };
 });

 app.patch("/api/v1/sidec/continuity/runbook/recommendations/:id",{preHandler:requirePermission("sidec_continuity_improvement.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=recommendationUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const before=await db.query(`SELECT * FROM sidec_continuity_runbook_recommendations WHERE id=$1 AND organization_id=$2`,[id,org]);
  const row=before.rows[0] as any;if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  if(row.status==="IMPLEMENTED"||row.status==="DISMISSED")return reply.code(409).send({error:"RECOMMENDATION_ALREADY_RESOLVED"});
  if(parsed.data.status==="IMPLEMENTED")return reply.code(409).send({error:"CHANGE_PROPOSAL_REQUIRED"});
  if(parsed.data.status==="DISMISSED"){
   const activeProposal=await db.query(`SELECT id FROM sidec_continuity_change_proposals
     WHERE recommendation_id=$1 AND organization_id=$2 AND status<>'CANCELLED' LIMIT 1`,[id,org]);
   if(activeProposal.rows[0])return reply.code(409).send({error:"ACTIVE_CHANGE_PROPOSAL_EXISTS",proposalId:activeProposal.rows[0].id});
  }
  const resolved=parsed.data.status==="DISMISSED";
  const updated=await db.query(`UPDATE sidec_continuity_runbook_recommendations SET status=$1,resolution_notes=$2,
    resolved_by=CASE WHEN $3 THEN $4 ELSE NULL END,resolved_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now()
    WHERE id=$5 AND organization_id=$6
    RETURNING id,recurrence_key AS "recurrenceKey",status,resolution_notes AS "resolutionNotes",resolved_at AS "resolvedAt"`,[
    parsed.data.status,parsed.data.notes,resolved,auth.userId,id,org
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_continuity.runbook_recommendation_update','sidec_continuity_runbook_recommendation',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(row),JSON.stringify(updated.rows[0])
  ]);
  return updated.rows[0];
 });

 app.post("/api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId/promote-recovery",{preHandler:requirePermission("sidec_continuity_improvement.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{exerciseId,actionId}=request.params as {exerciseId:string;actionId:string};
  const parsed=promoteRecoverySchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const current=await db.query(`SELECT ai.*,a.status AS aar_status,a.id AS aar_id,e.plan_id,
    owner.display_name AS "ownerName",p.version AS "planVersion"
   FROM sidec_continuity_action_items ai
   JOIN sidec_continuity_aars a ON a.id=ai.aar_id
   JOIN sidec_continuity_exercises e ON e.id=a.exercise_id
   JOIN sidec_continuity_plans p ON p.id=e.plan_id
   LEFT JOIN users owner ON owner.id=ai.owner_user_id
   WHERE ai.id=$1 AND a.exercise_id=$2 AND a.organization_id=$3`,[actionId,exerciseId,org]);
  const row=current.rows[0] as any;if(!row)return reply.code(404).send({error:"ACTION_NOT_FOUND"});
  if(row.aar_status!=="FINAL")return reply.code(409).send({error:"FINAL_AAR_REQUIRED"});
  if(row.status==="CANCELLED")return reply.code(409).send({error:"CANCELLED_ACTION_NOT_PROMOTABLE"});
  if(row.recovery_action_id)return reply.code(409).send({error:"RECOVERY_ALREADY_LINKED",recoveryActionId:row.recovery_action_id});
  const existing=await db.query(`SELECT id FROM recovery_actions WHERE source_continuity_action_id=$1 AND organization_id=$2`,[actionId,org]);
  if(existing.rows[0]){
   await db.query(`UPDATE sidec_continuity_action_items SET recovery_action_id=$1,updated_at=now() WHERE id=$2`,[existing.rows[0].id,actionId]);
   return {recoveryActionId:existing.rows[0].id,reused:true};
  }
  const responsible=parsed.data.responsible??row.ownerName??null;
  const dueAt=parsed.data.dueAt??row.due_at??null;
  const notes=[
   `Origem: ação corretiva do AAR de continuidade SIDEC, runbook v${row.planVersion}.`,
   row.description?String(row.description):null,
   parsed.data.notes??null
  ].filter(Boolean).join("\n\n").slice(0,5000);
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const created=await client.query(`INSERT INTO recovery_actions(
      organization_id,title,category,status,responsible,due_at,notes,source_continuity_action_id
     ) VALUES($1,$2,$3,'PLANNED',$4,$5,$6,$7)
     RETURNING id,title,category,status,responsible,due_at AS "dueAt"`,[
      org,parsed.data.title??row.title,parsed.data.category,responsible,dueAt,notes,actionId
    ]);
   const recovery=created.rows[0];
   await client.query(`UPDATE sidec_continuity_action_items SET recovery_action_id=$1,updated_at=now() WHERE id=$2`,[recovery.id,actionId]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
     VALUES($1,'sidec_continuity.action_promote_recovery','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
      auth.userId,actionId,request.ip,request.headers["user-agent"]??null,JSON.stringify(row),JSON.stringify(recovery),
      JSON.stringify({exerciseId,confirmed:true})
    ]);
   await client.query("COMMIT");
   return reply.code(201).send({recoveryAction:recovery,reused:false});
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
 });

 app.patch("/api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId/effectiveness",{preHandler:requirePermission("sidec_continuity.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{exerciseId,actionId}=request.params as {exerciseId:string;actionId:string};
  const parsed=aarActionEffectivenessSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const current=await db.query(`SELECT ai.*,a.organization_id FROM sidec_continuity_action_items ai
    JOIN sidec_continuity_aars a ON a.id=ai.aar_id
    WHERE ai.id=$1 AND a.exercise_id=$2 AND a.organization_id=$3`,[actionId,exerciseId,org]);
  const row=current.rows[0] as any;
  if(!row)return reply.code(404).send({error:"ACTION_NOT_FOUND"});
  if(row.status!=="DONE")return reply.code(409).send({error:"DONE_ACTION_REQUIRED"});
  const updated=await db.query(`UPDATE sidec_continuity_action_items
    SET effectiveness=$1,effectiveness_notes=$2,effectiveness_evaluated_at=now(),effectiveness_evaluated_by=$3,updated_at=now()
    WHERE id=$4
    RETURNING id,effectiveness,effectiveness_notes AS "effectivenessNotes",
      effectiveness_evaluated_at AS "effectivenessEvaluatedAt"`,[
    parsed.data.effectiveness,parsed.data.notes,auth.userId,actionId
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
    VALUES($1,'sidec_continuity.action_effectiveness','sidec_continuity_action_item',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
    auth.userId,actionId,request.ip,request.headers["user-agent"]??null,JSON.stringify(row),JSON.stringify(updated.rows[0]),
    JSON.stringify({exerciseId})
  ]);
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
  await refreshRunbookRecommendations(org);
  return loadExercise(org,id);
 });

 app.get("/api/v1/sidec/continuity/exercises/:id/report.pdf",{preHandler:requirePermission("sidec_continuity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};const exercise=await loadExercise(org,id);if(!exercise)return reply.code(404).send({error:"NOT_FOUND"});
  const organization=await db.query(`SELECT name FROM organizations WHERE id=$1`,[org]);
  const pdf=await buildContinuityExerciseReportPdf({organizationName:String(organization.rows[0]?.name??"Organização"),exercise,aar:exercise.aar});
  return reply.type("application/pdf").header("Content-Disposition",`attachment; filename="SIGDEC-continuity-exercise-${id}.pdf"`).header("Content-Length",String(pdf.length)).send(pdf);
 });

}
