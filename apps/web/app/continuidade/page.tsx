"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Operator={id:string;matricula:string;displayName:string;jobTitle?:string|null};
type RunbookStep={id?:string;lineageKey?:string;sourceLineageKeys?:string[];phase:"DECLARATION"|"COMMUNICATION"|"PRESERVATION"|"RECOVERY"|"VALIDATION"|"RETURN";sortOrder:number;title:string;instructions:string;expectedMinutes:number;ownerUserId?:string|null;ownerName?:string|null;ownerMatricula?:string|null;required:boolean};
type RunbookPlan={id:string;version:number;title:string;status:"DRAFT"|"ACTIVE"|"RETIRED";activationCriteria:string;recoveryStrategy:string;communicationPlan:string;returnToNormal:string;updatedAt:string;activatedAt?:string|null;activatedByName?:string|null;steps:RunbookStep[]};
type RunbookData={active:RunbookPlan|null;draft:RunbookPlan|null;revisions:Array<{id:string;version:number;title:string;status:string;updatedAt:string}>;operators:Operator[]};
type Evidence={id:string;evidenceType:"NOTE"|"LINK"|"DOCUMENT"|"HASH";title:string;reference:string;contentHash?:string|null;createdAt:string;createdByName?:string|null};
type ExerciseStep={stepId:string;phase:string;title:string;instructions:string;expectedMinutes:number;required:boolean;ownerName?:string|null;status:"PENDING"|"COMPLETED"|"SKIPPED"|"FAILED";notes?:string|null;evidence:Evidence[]};
type AarAction={id:string;title:string;description?:string|null;priority:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";ownerUserId?:string|null;ownerName?:string|null;dueAt?:string|null;status:"OPEN"|"IN_PROGRESS"|"DONE"|"CANCELLED";completedAt?:string|null;riskId?:string|null;riskCode?:string|null;riskTitle?:string|null;recoveryActionId?:string|null;recoveryActionTitle?:string|null;recoveryActionStatus?:string|null;recurrenceKey?:string|null;effectiveness:"NOT_EVALUATED"|"EFFECTIVE"|"PARTIAL"|"INEFFECTIVE";effectivenessNotes?:string|null;effectivenessEvaluatedAt?:string|null;effectivenessEvaluatedByName?:string|null};
type Aar={id:string;status:"DRAFT"|"FINAL";executiveSummary:string;strengths:string;gaps:string;recommendations:string;finalizedAt?:string|null;finalizedByName?:string|null;actions:AarAction[];lessons?:Array<{id:string;category:string;recurrenceKey:string;title:string;observation:string;severity:string;createdAt:string}>};
type Exercise={id:string;planId:string;planVersion:number;planTitle:string;scenario:string;status:"IN_PROGRESS"|"COMPLETED"|"CANCELLED";result?:"PASS"|"PARTIAL"|"FAIL"|null;notes?:string|null;startedAt:string;completedAt?:string|null;summary:{total:number;completed:number;skipped:number;failed:number;pending:number;requiredPending:number;progressPct:number};steps:ExerciseStep[];aar?:Aar|null};
type ContinuitySchedule={id:string;name:string;intervalDays:number;nextDueAt:string;defaultScenario:string;ownerUserId?:string|null;ownerName?:string|null;enabled:boolean;lastExerciseId?:string|null;dueState:"SCHEDULED"|"DUE_SOON"|"OVERDUE"|"DISABLED"};
type ContinuityContact={id:string;contactScope:"INTERNAL"|"EXTERNAL";escalationLevel:number;name:string;roleTitle?:string|null;organizationName?:string|null;channelType:"PHONE"|"EMAIL"|"RADIO"|"OTHER";channelValue:string;notes?:string|null;active:boolean};
type ActionAlert={id:string;actionId:string;alertType:"DUE_SOON"|"OVERDUE";dueAt:string;detectedAt:string;title:string;priority:string;status:string;ownerName?:string|null;exerciseId:string;scenario:string;planVersion:number};
type LessonSummary={recurrenceKey:string;category:string;occurrences:number;lastSeenAt:string;titles:string[]};
type LessonRecent={id:string;category:string;recurrenceKey:string;title:string;observation:string;severity:string;createdAt:string;exerciseId:string;planVersion:number};
type RiskReference={id:string;code:string;title:string;category:string;status:string;probability:number;impact:number};
type RecoveryReference={id:string;title:string;category:string;status:string;responsible?:string|null;dueAt?:string|null};
type ActionMetrics={summary:{total:number;done:number;overdue:number;linkedRisks:number;linkedRecoveryActions:number;avgCompletionHours?:number|null;onTimePct?:number|null;effective:number;partial:number;ineffective:number;awaitingEffectiveness:number};byPriority:Array<{priority:string;total:number;done:number;avgCompletionHours?:number|null}>;byRecurrenceKey:Array<{recurrenceKey:string;actions:number;exercises:number;effective:number;partial:number;ineffective:number;awaitingEffectiveness:number;firstExerciseAt:string;lastExerciseAt:string}>};
type RunbookRecommendation={id:string;recurrenceKey:string;category:string;severity:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";title:string;rationale:string;occurrences:number;firstSeenAt:string;lastSeenAt:string;status:"OPEN"|"ACCEPTED"|"IMPLEMENTED"|"DISMISSED";resolutionNotes?:string|null;resolvedByName?:string|null};
type EffectivenessHistory={recurrenceKey:string;history:Array<{exerciseId:string;planVersion:number;startedAt:string;completedAt?:string|null;actionId:string;title:string;status:string;effectiveness:string;effectivenessNotes?:string|null;effectivenessEvaluatedAt?:string|null}>};
type ChangeEvidence={id:string;evidenceType:"NOTE"|"LINK"|"DOCUMENT"|"HASH";title:string;reference:string;contentHash?:string|null;createdAt:string;createdByName?:string|null};
type ChangeApproval={id:string;decision:"APPROVED"|"REJECTED";notes:string;decidedAt:string;validUntil?:string|null;revalidatedAt?:string|null;decidedById:string;decidedByName?:string|null;authorityUserId?:string|null;authorityUserName?:string|null;delegationId?:string|null;delegated?:boolean};
type ApprovalDelegation={id:string;delegatorUserId:string;delegatorName?:string|null;delegatorMatricula?:string|null;delegateUserId:string;delegateName?:string|null;delegateMatricula?:string|null;validFrom:string;validUntil:string;reason:string;revokedAt?:string|null;createdAt:string;status:"ACTIVE"|"SCHEDULED"|"EXPIRED"|"REVOKED"};
type ChangePolicy={approvalValidHours:number;reportWormRetentionDays?:number|null;reportWormLegalHold:boolean;updatedAt?:string|null};
type EffectivenessTarget={id?:string;scopeType:"DEFAULT"|"CATEGORY"|"RECURRENCE";scopeValue:string;minVerifiedRate?:number|null;minImprovedRate?:number|null;maxAvgApplyHours?:number|null;maxAvgVerificationHours?:number|null;enabled:boolean;state?:"PASS"|"FAIL"|"NO_DATA"|"DISABLED";actual?:{total:number;verified:number;improved:number;verifiedRate?:number|null;improvedRate?:number|null;avgApplyHours?:number|null;avgVerificationHours?:number|null}};
type ChangeMetrics={summary:{total:number;proposed:number;applied:number;verified:number;cancelled:number;critical:number;sealed:number;archived:number;archiveHealthy:number;replicated:number;replicaHealthy:number;activeDelegations:number;reportResilienceOpen:number;reportRetryPending:number;reportRestoreFailures30d:number;approvalsExpiring24h:number;approvalsExpired:number;improved:number;stable:number;regressed:number;noBaseline:number;verifiedRate?:number|null;improvedRate?:number|null;avgApplyHours?:number|null;avgVerificationHours?:number|null};bySeverity:Array<{severity:string;total:number;verified:number;improved:number;regressed:number}>;byMonth:Array<{month:string;total:number;verified:number;improved:number;regressed:number}>;byRecurrence:Array<{recurrenceKey:string;proposals:number;verified:number;improved:number;regressed:number;lastProposalAt:string}>};
type ChangeProposal={id:string;recommendationId:string;recurrenceKey:string;recommendationTitle:string;recommendationStatus:string;recommendationSeverity:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";targetPlanId:string;targetPlanVersion:number;targetPlanTitle:string;targetPlanStatus:"DRAFT"|"ACTIVE"|"RETIRED";basePlanId?:string|null;basePlanVersion?:number|null;basePlanTitle?:string|null;proposalText:string;status:"PROPOSED"|"APPLIED"|"VERIFIED"|"CANCELLED";statusNotes?:string|null;appliedAt?:string|null;verifiedAt?:string|null;verificationExerciseId?:string|null;verificationExerciseResult?:string|null;verificationExerciseStartedAt?:string|null;baselineExerciseId?:string|null;baselineExerciseResult?:string|null;effectivenessOutcome?:"NO_BASELINE"|"IMPROVED"|"STABLE"|"REGRESSED"|null;diffSummary:{fieldsChanged:number;stepsAdded:number;stepsModified:number;stepsRemoved:number;stepsSplit?:number;stepsMerged?:number;stepsDerived?:number;totalChanges:number};createdAt:string;createdById?:string|null;createdByName?:string|null;appliedByName?:string|null;verifiedByName?:string|null;approvedCount:number;expiredApprovalCount:number;rejectedCount:number;criticalApprovalSatisfied:boolean;reportSealed:boolean;reportArchived:boolean;reportArchiveHealthy:boolean;reportHash?:string|null;reportSealKeyId?:string|null;reportSealFingerprint?:string|null;reportSealedAt?:string|null;reportSealedByName?:string|null;reportArchiveBucket?:string|null;reportArchiveObjectKey?:string|null;reportArchiveRetainUntil?:string|null;reportArchiveLegalHold?:boolean|null;reportArchivedAt?:string|null;reportArchiveVerifiedAt?:string|null;reportArchiveErrorMessage?:string|null;reportReplicaCreated:boolean;reportReplicaHealthy:boolean;reportReplicationHealthy:boolean;reportReplicaBucket?:string|null;reportReplicaObjectKey?:string|null;reportReplicaRetainUntil?:string|null;reportReplicaLegalHold?:boolean|null;reportReplicatedAt?:string|null;reportReplicaVerifiedAt?:string|null;reportReplicaErrorMessage?:string|null;approvals:ChangeApproval[];evidence:ChangeEvidence[];impacts?:Array<{id:string;stepKey:string;changeType:"ADDED"|"MODIFIED"|"REMOVED"|"SPLIT"|"MERGED"|"DERIVED";phase:string;sortOrder:number;title:string;changedFields:string[];lineageDetails?:Record<string,unknown>}>};

const phaseLabels:Record<string,string>={DECLARATION:"Declaração",COMMUNICATION:"Comunicação",PRESERVATION:"Preservação",RECOVERY:"Recuperação",VALIDATION:"Validação",RETURN:"Retorno à normalidade"};
const resultLabels:Record<string,string>={PASS:"Aprovado",PARTIAL:"Parcial",FAIL:"Falhou"};

export default function ContinuidadePage(){
 const [runbook,setRunbook]=useState<RunbookData|null>(null);
 const [exercises,setExercises]=useState<Exercise[]>([]);
 const [schedules,setSchedules]=useState<ContinuitySchedule[]>([]);
 const [contacts,setContacts]=useState<ContinuityContact[]>([]);
 const [actionAlerts,setActionAlerts]=useState<ActionAlert[]>([]);
 const [lessonSummary,setLessonSummary]=useState<LessonSummary[]>([]);
 const [lessonRecent,setLessonRecent]=useState<LessonRecent[]>([]);
 const [riskReferences,setRiskReferences]=useState<RiskReference[]>([]);
 const [recoveryReferences,setRecoveryReferences]=useState<RecoveryReference[]>([]);
 const [actionMetrics,setActionMetrics]=useState<ActionMetrics|null>(null);
 const [runbookRecommendations,setRunbookRecommendations]=useState<RunbookRecommendation[]>([]);
 const [effectivenessHistory,setEffectivenessHistory]=useState<EffectivenessHistory[]>([]);
 const [changeProposals,setChangeProposals]=useState<ChangeProposal[]>([]);
 const [changeMetrics,setChangeMetrics]=useState<ChangeMetrics|null>(null);
 const [changePolicy,setChangePolicy]=useState<ChangePolicy|null>(null);
 const [approvalDelegations,setApprovalDelegations]=useState<ApprovalDelegation[]>([]);
 const [effectivenessTargets,setEffectivenessTargets]=useState<EffectivenessTarget[]>([]);
 const [targetDraft,setTargetDraft]=useState({scopeType:"DEFAULT" as "DEFAULT"|"CATEGORY"|"RECURRENCE",scopeValue:"*",minVerifiedRate:"",minImprovedRate:"",maxAvgApplyHours:"",maxAvgVerificationHours:""});
 const [governancePeriod,setGovernancePeriod]=useState({from:"",to:""});
 const [delegationDraft,setDelegationDraft]=useState({delegateUserId:"",validUntil:"",reason:"Substituição temporária formal para decisões críticas do runbook SIDEC."});
 const [scheduleDraft,setScheduleDraft]=useState({name:"Exercício periódico SIDEC",intervalDays:90,nextDueAt:"",defaultScenario:"Exercício periódico de mesa para validar o Plano de Continuidade SIDEC e as evidências operacionais.",ownerUserId:""});
 const [contactDraft,setContactDraft]=useState({contactScope:"EXTERNAL",escalationLevel:1,name:"",roleTitle:"",organizationName:"",channelType:"PHONE",channelValue:"",notes:""});
 const [lessonDraft,setLessonDraft]=useState({category:"PROCESS",recurrenceKey:"",title:"",observation:"",severity:"MEDIUM"});
 const [scenario,setScenario]=useState("Exercício de mesa para validar o Plano de Continuidade SIDEC, responsáveis, preservação, recuperação, validação e retorno à normalidade.");
 const [finishNotes,setFinishNotes]=useState("");
 const [stepNotes,setStepNotes]=useState<Record<string,string>>({});
 const [evidenceDrafts,setEvidenceDrafts]=useState<Record<string,{evidenceType:"NOTE"|"LINK"|"DOCUMENT"|"HASH";title:string;reference:string;contentHash:string}>>({});
 const [selectedExerciseId,setSelectedExerciseId]=useState<string|null>(null);
 const [aarDraft,setAarDraft]=useState({executiveSummary:"",strengths:"",gaps:"",recommendations:""});
 const [actionDraft,setActionDraft]=useState({title:"",description:"",priority:"MEDIUM",ownerUserId:"",dueAt:"",riskId:"",recoveryActionId:"",recurrenceKey:""});
 const [effectivenessDrafts,setEffectivenessDrafts]=useState<Record<string,{effectiveness:"EFFECTIVE"|"PARTIAL"|"INEFFECTIVE";notes:string}>>({});
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const response=await fetch(API+path,{credentials:"include",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(response.status===401){location.href="/login";return null}
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
   const details=Array.isArray(payload?.details)?payload.details.join(" "):payload?.details?JSON.stringify(payload.details):"";
   throw new Error(payload?.message||payload?.error||details||"Não foi possível concluir a operação.");
  }
  return payload;
 },[]);

 const load=useCallback(async()=>{
  try{
   const [r,e,s,cnt,aa,ls,refs,metrics,recommendations,history,proposals,changeStats,policy,delegations,targets]=await Promise.all([
    request("/api/v1/sidec/continuity/runbook"),
    request("/api/v1/sidec/continuity/exercises"),
    request("/api/v1/sidec/continuity/schedules"),
    request("/api/v1/sidec/continuity/contacts"),
    request("/api/v1/sidec/continuity/action-alerts"),
    request("/api/v1/sidec/continuity/lessons"),
    request("/api/v1/sidec/continuity/action-references"),
    request("/api/v1/sidec/continuity/actions/metrics"),
    request("/api/v1/sidec/continuity/runbook/recommendations"),
    request("/api/v1/sidec/continuity/actions/effectiveness-history"),
    request("/api/v1/sidec/continuity/runbook/change-proposals"),
    request("/api/v1/sidec/continuity/runbook/change-metrics"),
    request("/api/v1/sidec/continuity/runbook/change-policy"),
    request("/api/v1/sidec/continuity/runbook/approval-delegations"),
    request("/api/v1/sidec/continuity/runbook/effectiveness-targets")
   ]);
   if(r)setRunbook(r);
   if(e)setExercises(e.items??[]);
   if(s)setSchedules(s.items??[]);
   if(cnt)setContacts(cnt.items??[]);
   if(aa)setActionAlerts(aa.items??[]);
   if(ls){setLessonSummary(ls.summary??[]);setLessonRecent(ls.recent??[]);}
   if(refs){setRiskReferences(refs.risks??[]);setRecoveryReferences(refs.recoveryActions??[]);}
   if(metrics)setActionMetrics(metrics);
   if(recommendations)setRunbookRecommendations(recommendations.items??[]);
   if(history)setEffectivenessHistory(history.items??[]);
   if(proposals)setChangeProposals(proposals.items??[]);
   if(changeStats)setChangeMetrics(changeStats);
   if(policy)setChangePolicy(policy);
   if(delegations)setApprovalDelegations(delegations.items??[]);
   if(targets)setEffectivenessTargets(targets.items??[]);
   setError("");
  }catch(err){setError(err instanceof Error?err.message:"Serviço indisponível.")}
 },[request]);

 useEffect(()=>{void load()},[load]);

 async function act(action:()=>Promise<void>){
  setBusy(true);setMessage("");
  try{await action();await load()}catch(err){setMessage(err instanceof Error?err.message:"Falha na operação.")}
  finally{setBusy(false)}
 }

 function patchDraft(patch:Partial<RunbookPlan>){
  if(!runbook?.draft)return;
  setRunbook({...runbook,draft:{...runbook.draft,...patch}});
 }

 function patchStep(index:number,patch:Partial<RunbookStep>){
  if(!runbook?.draft)return;
  patchDraft({steps:runbook.draft.steps.map((step,i)=>i===index?{...step,...patch}:step)});
 }

 function stepOrigins(step:RunbookStep){
  if(step.sourceLineageKeys?.length)return [...step.sourceLineageKeys];
  return step.lineageKey?[step.lineageKey]:[];
 }

 function resequenceSteps(steps:RunbookStep[]){
  return steps.map((step,index)=>({...step,sortOrder:index+1}));
 }

 function splitDraftStep(index:number){
  const draft=runbook?.draft;if(!draft)return;
  const step=draft.steps[index];if(!step)return;
  const origins=stepOrigins(step);
  const base={...step,id:undefined,lineageKey:undefined,sourceLineageKeys:origins.length?origins:undefined};
  const first:{[K in keyof RunbookStep]?:RunbookStep[K]}={...base,title:(step.title+" · parte 1").slice(0,240)};
  const second:{[K in keyof RunbookStep]?:RunbookStep[K]}={...base,title:(step.title+" · parte 2").slice(0,240)};
  const next=[...draft.steps.slice(0,index),first as RunbookStep,second as RunbookStep,...draft.steps.slice(index+1)];
  patchDraft({steps:resequenceSteps(next)});
 }

 function mergeDraftStepWithNext(index:number){
  const draft=runbook?.draft;if(!draft||draft.steps.length<=6)return;
  const left=draft.steps[index],right=draft.steps[index+1];if(!left||!right)return;
  const origins=[...new Set([...stepOrigins(left),...stepOrigins(right)])];
  const merged:RunbookStep={
   phase:left.phase,sortOrder:left.sortOrder,title:(left.title+" + "+right.title).slice(0,240),
   instructions:(left.instructions+"\n\n"+right.instructions).slice(0,12000),
   expectedMinutes:Math.min(10080,left.expectedMinutes+right.expectedMinutes),
   ownerUserId:left.ownerUserId??right.ownerUserId??null,required:left.required||right.required,
   sourceLineageKeys:origins.length?origins:undefined
  };
  const next=[...draft.steps.slice(0,index),merged,...draft.steps.slice(index+2)];
  patchDraft({steps:resequenceSteps(next)});
 }

 const numericOrNull=(value:string)=>value.trim()===""?null:Number(value);

 const saveEffectivenessTarget=()=>act(async()=>{
  const scopeValue=targetDraft.scopeType==="DEFAULT"?"*":targetDraft.scopeValue.trim();
  if(targetDraft.scopeType!=="DEFAULT"&&scopeValue.length<2)throw new Error("Informe o valor do escopo da meta.");
  const item={
   scopeType:targetDraft.scopeType,scopeValue,
   minVerifiedRate:numericOrNull(targetDraft.minVerifiedRate),
   minImprovedRate:numericOrNull(targetDraft.minImprovedRate),
   maxAvgApplyHours:numericOrNull(targetDraft.maxAvgApplyHours),
   maxAvgVerificationHours:numericOrNull(targetDraft.maxAvgVerificationHours),enabled:true
  };
  if([item.minVerifiedRate,item.minImprovedRate,item.maxAvgApplyHours,item.maxAvgVerificationHours].every(x=>x===null))throw new Error("Informe pelo menos uma meta quantitativa.");
  const existing=effectivenessTargets.filter(x=>!(x.scopeType===item.scopeType&&x.scopeValue.toLowerCase()===item.scopeValue.toLowerCase()));
  const clean=existing.map(x=>({scopeType:x.scopeType,scopeValue:x.scopeValue,minVerifiedRate:x.minVerifiedRate??null,minImprovedRate:x.minImprovedRate??null,maxAvgApplyHours:x.maxAvgApplyHours??null,maxAvgVerificationHours:x.maxAvgVerificationHours??null,enabled:x.enabled}));
  await request("/api/v1/sidec/continuity/runbook/effectiveness-targets",{method:"PUT",body:JSON.stringify({items:[...clean,item]})});
  setTargetDraft({scopeType:"DEFAULT",scopeValue:"*",minVerifiedRate:"",minImprovedRate:"",maxAvgApplyHours:"",maxAvgVerificationHours:""});
  setMessage("Meta quantitativa salva.");
 });

 const deleteEffectivenessTarget=(target:EffectivenessTarget)=>act(async()=>{
  if(!window.confirm(`Excluir a meta ${target.scopeType} · ${target.scopeValue}?`))return;
  const clean=effectivenessTargets.filter(x=>x!==target).map(x=>({scopeType:x.scopeType,scopeValue:x.scopeValue,minVerifiedRate:x.minVerifiedRate??null,minImprovedRate:x.minImprovedRate??null,maxAvgApplyHours:x.maxAvgApplyHours??null,maxAvgVerificationHours:x.maxAvgVerificationHours??null,enabled:x.enabled}));
  await request("/api/v1/sidec/continuity/runbook/effectiveness-targets",{method:"PUT",body:JSON.stringify({items:clean})});
  setMessage("Meta quantitativa excluída.");
 });

 const createSchedule=()=>act(async()=>{
  await request("/api/v1/sidec/continuity/schedules",{method:"POST",body:JSON.stringify({
   name:scheduleDraft.name,intervalDays:scheduleDraft.intervalDays,nextDueAt:scheduleDraft.nextDueAt,
   defaultScenario:scheduleDraft.defaultScenario,ownerUserId:scheduleDraft.ownerUserId||null,enabled:true
  })});
  setMessage("Agenda periódica criada.");
 });
 const toggleSchedule=(item:ContinuitySchedule)=>act(async()=>{
  await request("/api/v1/sidec/continuity/schedules/"+item.id,{method:"PATCH",body:JSON.stringify({enabled:!item.enabled})});
  setMessage(item.enabled?"Agenda pausada.":"Agenda reativada.");
 });
 const startScheduledExercise=(item:ContinuitySchedule)=>act(async()=>{
  await request("/api/v1/sidec/continuity/exercises",{method:"POST",body:JSON.stringify({scheduleId:item.id})});
  setMessage("Exercício agendado iniciado de forma controlada.");
 });
 const createContact=()=>act(async()=>{
  await request("/api/v1/sidec/continuity/contacts",{method:"POST",body:JSON.stringify({
   contactScope:contactDraft.contactScope,escalationLevel:contactDraft.escalationLevel,name:contactDraft.name,
   roleTitle:contactDraft.roleTitle||null,organizationName:contactDraft.organizationName||null,
   channelType:contactDraft.channelType,channelValue:contactDraft.channelValue,notes:contactDraft.notes||null,active:true
  })});
  setContactDraft({contactScope:"EXTERNAL",escalationLevel:1,name:"",roleTitle:"",organizationName:"",channelType:"PHONE",channelValue:"",notes:""});
  setMessage("Contato incluído na matriz de escalonamento.");
 });
 const toggleContact=(item:ContinuityContact)=>act(async()=>{
  await request("/api/v1/sidec/continuity/contacts/"+item.id,{method:"PATCH",body:JSON.stringify({active:!item.active})});
  setMessage(item.active?"Contato desativado.":"Contato reativado.");
 });
 const acknowledgeActionAlert=(id:string)=>act(async()=>{
  await request("/api/v1/sidec/continuity/action-alerts/"+id+"/ack",{method:"PATCH",body:"{}"});
  setMessage("Alerta da ação corretiva reconhecido.");
 });
 const addLesson=()=>act(async()=>{
  if(!selectedExerciseId)return;
  await request(`/api/v1/sidec/continuity/exercises/${selectedExerciseId}/aar/lessons`,{method:"POST",body:JSON.stringify(lessonDraft)});
  setLessonDraft({category:"PROCESS",recurrenceKey:"",title:"",observation:"",severity:"MEDIUM"});
  setMessage("Lição aprendida estruturada adicionada ao AAR.");
 });

 const createRevision=()=>act(async()=>{
  await request("/api/v1/sidec/continuity/runbook/revisions",{method:"POST",body:JSON.stringify({cloneActive:true})});
  setMessage("Nova revisão criada em rascunho.");
 });

 const saveDraft=()=>act(async()=>{
  const draft=runbook?.draft;if(!draft)return;
  await request("/api/v1/sidec/continuity/runbook/"+draft.id,{
   method:"PUT",
   body:JSON.stringify({
    title:draft.title,activationCriteria:draft.activationCriteria,recoveryStrategy:draft.recoveryStrategy,
    communicationPlan:draft.communicationPlan,returnToNormal:draft.returnToNormal,
    steps:draft.steps.map(step=>({lineageKey:step.lineageKey,sourceLineageKeys:step.sourceLineageKeys,phase:step.phase,sortOrder:step.sortOrder,title:step.title,instructions:step.instructions,expectedMinutes:step.expectedMinutes,ownerUserId:step.ownerUserId||null,required:step.required}))
   })
  });
  setMessage("Rascunho salvo.");
 });

 const activateDraft=()=>act(async()=>{
  const draft=runbook?.draft;if(!draft)return;
  await request("/api/v1/sidec/continuity/runbook/"+draft.id+"/activate",{method:"POST",body:"{}"});
  setMessage("Runbook ativado e revisão anterior preservada no histórico.");
 });

 const startExercise=()=>act(async()=>{
  await request("/api/v1/sidec/continuity/exercises",{method:"POST",body:JSON.stringify({scenario})});
  setMessage("Exercício de mesa iniciado. Nenhum failover real foi executado.");
 });

 const updateExerciseStep=(exerciseId:string,stepId:string,status:ExerciseStep["status"])=>act(async()=>{
  await request("/api/v1/sidec/continuity/exercises/"+exerciseId+"/steps/"+stepId,{method:"PATCH",body:JSON.stringify({status,notes:stepNotes[stepId]||null})});
  setMessage("Etapa atualizada.");
 });

 const addEvidence=(exerciseId:string,stepId:string)=>act(async()=>{
  const draft=evidenceDrafts[stepId]??{evidenceType:"NOTE",title:"",reference:"",contentHash:""};
  await request(`/api/v1/sidec/continuity/exercises/${exerciseId}/steps/${stepId}/evidence`,{method:"POST",body:JSON.stringify({evidenceType:draft.evidenceType,title:draft.title,reference:draft.reference,contentHash:draft.contentHash||null})});
  setEvidenceDrafts(value=>({...value,[stepId]:{evidenceType:"NOTE",title:"",reference:"",contentHash:""}}));
  setMessage("Evidência registrada na etapa.");
 });

 function openAar(exercise:Exercise){
  setSelectedExerciseId(exercise.id);
  setAarDraft({executiveSummary:exercise.aar?.executiveSummary??"",strengths:exercise.aar?.strengths??"",gaps:exercise.aar?.gaps??"",recommendations:exercise.aar?.recommendations??""});
 }

 const saveAar=()=>act(async()=>{
  if(!selectedExerciseId)return;
  await request(`/api/v1/sidec/continuity/exercises/${selectedExerciseId}/aar`,{method:"PUT",body:JSON.stringify(aarDraft)});
  setMessage("AAR salvo em rascunho.");
 });

 const addAarAction=()=>act(async()=>{
  if(!selectedExerciseId)return;
  await request(`/api/v1/sidec/continuity/exercises/${selectedExerciseId}/aar/actions`,{method:"POST",body:JSON.stringify({
   title:actionDraft.title,description:actionDraft.description,priority:actionDraft.priority,
   ownerUserId:actionDraft.ownerUserId||null,dueAt:actionDraft.dueAt||null,
   riskId:actionDraft.riskId||null,recoveryActionId:actionDraft.recoveryActionId||null,recurrenceKey:actionDraft.recurrenceKey||null
  })});
  setActionDraft({title:"",description:"",priority:"MEDIUM",ownerUserId:"",dueAt:"",riskId:"",recoveryActionId:"",recurrenceKey:""});
  setMessage("Ação corretiva adicionada.");
 });

 const finalizeAar=()=>act(async()=>{
  if(!selectedExerciseId)return;
  await request(`/api/v1/sidec/continuity/exercises/${selectedExerciseId}/aar/finalize`,{method:"POST",body:"{}"});
  setMessage("AAR finalizado e conteúdo congelado.");
 });

 const updateActionStatus=(exerciseId:string,actionId:string,status:AarAction["status"])=>act(async()=>{
  await request(`/api/v1/sidec/continuity/exercises/${exerciseId}/aar/actions/${actionId}`,{method:"PATCH",body:JSON.stringify({status})});
  setMessage("Situação da ação corretiva atualizada.");
 });

 const evaluateActionEffectiveness=(exerciseId:string,action:AarAction)=>act(async()=>{
  const draft=effectivenessDrafts[action.id]??{effectiveness:"EFFECTIVE" as const,notes:""};
  await request(`/api/v1/sidec/continuity/exercises/${exerciseId}/aar/actions/${action.id}/effectiveness`,{
   method:"PATCH",body:JSON.stringify(draft)
  });
  setEffectivenessDrafts(value=>{const next={...value};delete next[action.id];return next});
  setMessage("Eficácia da ação corretiva registrada.");
 });

 const promoteRecovery=(exerciseId:string,action:AarAction)=>act(async()=>{
  if(!window.confirm(`Criar uma ação de recuperação a partir de "${action.title}"? Esta operação cria um novo registro e mantém o vínculo de origem.`))return;
  await request(`/api/v1/sidec/continuity/exercises/${exerciseId}/aar/actions/${action.id}/promote-recovery`,{
   method:"POST",
   body:JSON.stringify({confirm:true,category:"CONTINUIDADE_SIDEC",responsible:action.ownerName??null,dueAt:action.dueAt??null,notes:"Promoção confirmada pelo operador no Centro de Continuidade."})
  });
  setMessage("Ação de recuperação criada e vinculada à ação corretiva.");
 });

 const updateRecommendation=(item:RunbookRecommendation,status:"ACCEPTED"|"DISMISSED")=>act(async()=>{
  const defaultNote=status==="ACCEPTED"?"Recomendação aceita para análise na próxima revisão do runbook.":"Recomendação descartada após análise humana.";
  const notes=window.prompt("Fundamentação da decisão:",defaultNote);
  if(notes===null||notes.trim().length<5)throw new Error("Informe uma fundamentação com pelo menos 5 caracteres.");
  await request(`/api/v1/sidec/continuity/runbook/recommendations/${item.id}`,{method:"PATCH",body:JSON.stringify({status,notes})});
  setMessage("Recomendação de runbook atualizada.");
 });

 const createChangeProposal=(item:RunbookRecommendation)=>act(async()=>{
  const draft=runbook?.draft;
  if(!draft)throw new Error("Crie uma revisão em rascunho antes de vincular a recomendação.");
  const proposalText=window.prompt("Descreva objetivamente a mudança proposta para o runbook:",item.rationale);
  if(proposalText===null||proposalText.trim().length<10)throw new Error("Descreva a proposta com pelo menos 10 caracteres.");
  await request(`/api/v1/sidec/continuity/runbook/recommendations/${item.id}/change-proposal`,{
   method:"POST",body:JSON.stringify({targetPlanId:draft.id,proposalText})
  });
  setMessage(`Proposta vinculada ao rascunho v${draft.version}.`);
 });

 const addChangeEvidence=(proposal:ChangeProposal)=>act(async()=>{
  const title=window.prompt("Título da evidência:","Alteração aplicada na revisão do runbook");
  if(title===null||title.trim().length<3)throw new Error("Informe um título válido.");
  const reference=window.prompt("Descreva a evidência ou referência:","Revisão do conteúdo e das etapas conforme proposta aprovada.");
  if(reference===null||reference.trim().length<1)throw new Error("Informe a referência da evidência.");
  await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/evidence`,{
   method:"POST",body:JSON.stringify({evidenceType:"NOTE",title,reference,contentHash:null})
  });
  setMessage("Evidência de implementação registrada.");
 });

 const configureChangePolicy=()=>act(async()=>{
  const current=changePolicy??{approvalValidHours:168,reportWormRetentionDays:null,reportWormLegalHold:false};
  const approvalRaw=window.prompt("Validade das aprovações críticas, em horas:",String(current.approvalValidHours));
  if(approvalRaw===null)return;
  const approvalValidHours=Number(approvalRaw);
  if(!Number.isInteger(approvalValidHours)||approvalValidHours<1||approvalValidHours>2160)throw new Error("Informe entre 1 e 2160 horas.");
  const retentionRaw=window.prompt("Retenção WORM do relatório, em dias. Deixe vazio para não definir prazo:",current.reportWormRetentionDays==null?"":String(current.reportWormRetentionDays));
  if(retentionRaw===null)return;
  const reportWormRetentionDays=retentionRaw.trim()===""?null:Number(retentionRaw);
  if(reportWormRetentionDays!==null&&(!Number.isInteger(reportWormRetentionDays)||reportWormRetentionDays<1||reportWormRetentionDays>36500))throw new Error("Informe entre 1 e 36500 dias ou deixe vazio.");
  const reportWormLegalHold=window.confirm("Ativar legal hold para novos relatórios WORM? Use somente quando a política administrativa exigir preservação sem data.");
  await request("/api/v1/sidec/continuity/runbook/change-policy",{
   method:"PATCH",body:JSON.stringify({approvalValidHours,reportWormRetentionDays,reportWormLegalHold})
  });
  setMessage("Política de governança das mudanças atualizada.");
 });

 const createApprovalDelegation=()=>act(async()=>{
  if(!delegationDraft.delegateUserId)throw new Error("Selecione o usuário que receberá a delegação.");
  if(!delegationDraft.validUntil)throw new Error("Informe a validade da delegação.");
  if(delegationDraft.reason.trim().length<5)throw new Error("Informe a fundamentação da delegação.");
  await request("/api/v1/sidec/continuity/runbook/approval-delegations",{
   method:"POST",body:JSON.stringify({delegateUserId:delegationDraft.delegateUserId,validUntil:delegationDraft.validUntil,reason:delegationDraft.reason})
  });
  setDelegationDraft({delegateUserId:"",validUntil:"",reason:"Substituição temporária formal para decisões críticas do runbook SIDEC."});
  setMessage("Delegação temporária registrada com trilha de auditoria.");
 });

 const revokeApprovalDelegation=(item:ApprovalDelegation)=>act(async()=>{
  if(!window.confirm(`Revogar a delegação de ${item.delegateName??item.delegateMatricula??"usuário"}?`))return;
  await request(`/api/v1/sidec/continuity/runbook/approval-delegations/${item.id}/revoke`,{method:"POST",body:"{}"});
  setMessage("Delegação revogada. O histórico foi preservado.");
 });

 const decideCriticalProposal=(proposal:ChangeProposal,decision:"APPROVED"|"REJECTED")=>act(async()=>{
  const defaultNote=decision==="APPROVED"?"Mudança crítica analisada e aprovada para aplicação controlada.":"Mudança crítica rejeitada após análise.";
  const notes=window.prompt("Fundamentação da decisão:",defaultNote);
  if(notes===null||notes.trim().length<5)throw new Error("Informe a fundamentação da decisão.");
  await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/approval`,{
   method:"POST",body:JSON.stringify({decision,notes})
  });
  setMessage(decision==="APPROVED"?"Aprovação crítica registrada.":"Rejeição crítica registrada.");
 });

 const sealChangeReport=(proposal:ChangeProposal)=>act(async()=>{
  if(!window.confirm(`Selar definitivamente o relatório da mudança da revisão v${proposal.targetPlanVersion}? O PDF armazenado e a assinatura serão imutáveis.`))return;
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/seal`,{method:"POST",body:"{}"});
  setMessage(result?.valid?"Relatório selado com SHA-256 e assinatura Ed25519 válida.":"Relatório selado.");
 });

 const verifyChangeReportSeal=(proposal:ChangeProposal)=>act(async()=>{
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/seal`);
  setMessage(result?.valid?`Selo íntegro e assinatura válida · ${String(result.publicKeyFingerprint??"").slice(0,16)}…`:"A verificação do selo falhou.");
 });

 const archiveChangeReport=(proposal:ChangeProposal)=>act(async()=>{
  if(!window.confirm("Arquivar o PDF selado no WORM conforme a política vigente?"))return;
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive`,{method:"POST",body:"{}"});
  setMessage(result?.verification?.hashValid?"Relatório arquivado no WORM e hash remoto validado.":"Relatório enviado ao arquivo WORM.");
 });

 const verifyArchivedChangeReport=(proposal:ChangeProposal)=>act(async()=>{
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/verify`,{method:"POST",body:"{}"});
  setMessage(result?.existsRemote&&result?.hashValid?"Arquivo WORM íntegro e disponível.":"A verificação do arquivo WORM indicou problema.");
 });

 const replicateChangeReport=(proposal:ChangeProposal)=>act(async()=>{
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/replicate`,{method:"POST",body:"{}"});
  setMessage(result?.verification?.hashValid?"Réplica WORM secundária criada e validada.":"Operação de réplica concluída.");
 });

 const verifyChangeReportReplica=(proposal:ChangeProposal)=>act(async()=>{
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/replica/verify`,{method:"POST",body:"{}"});
  setMessage(result?.existsRemote&&result?.hashValid?"Réplica WORM íntegra.":"A verificação da réplica indicou problema.");
 });

 const syncChangeReportReplica=(proposal:ChangeProposal)=>act(async()=>{
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/replica/sync-policy`,{method:"POST",body:"{}"});
  setMessage(result?.synced?"Política da réplica sincronizada com o WORM principal.":"Sincronização concluída.");
 });

 const runChangeReportDrill=(proposal:ChangeProposal,destination:"PRIMARY"|"REPLICA")=>act(async()=>{
  if(!window.confirm(`Executar drill de restauração do relatório no destino ${destination==="PRIMARY"?"WORM principal":"réplica WORM"}? O arquivo será lido e validado sem alterar o conteúdo.`))return;
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/resilience/drill`,{
   method:"POST",body:JSON.stringify({destination})
  });
  setMessage(result?.success?`Drill ${destination} concluído: SHA-256, tamanho e assinatura PDF válidos.`:`Drill ${destination} indicou falha.`);
 });

 const extendChangeReportRetention=(proposal:ChangeProposal)=>act(async()=>{
  const current=proposal.reportArchiveRetainUntil?new Date(proposal.reportArchiveRetainUntil):new Date();
  current.setDate(current.getDate()+30);
  const retainUntil=window.prompt("Nova retenção até (ISO 8601 ou data reconhecida pelo navegador):",current.toISOString());
  if(retainUntil===null)return;
  if(Number.isNaN(new Date(retainUntil).getTime()))throw new Error("Data de retenção inválida.");
  const reason=window.prompt("Fundamentação para ampliar a retenção:","Ampliação administrativa da preservação do relatório selado.");
  if(reason===null||reason.trim().length<5)throw new Error("Informe a fundamentação.");
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/retention/extend`,{
   method:"POST",body:JSON.stringify({retainUntil,reason})
  });
  setMessage(result?.verification?.hashValid?"Retenção ampliada e integridade revalidada.":"Retenção ampliada.");
 });

 const enableChangeReportLegalHold=(proposal:ChangeProposal)=>act(async()=>{
  const reason=window.prompt("Fundamentação para ativar legal hold:","Preservação administrativa sem liberação automática.");
  if(reason===null||reason.trim().length<5)throw new Error("Informe a fundamentação.");
  const result=await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report/archive/legal-hold`,{
   method:"POST",body:JSON.stringify({reason})
  });
  setMessage(result?.verification?.hashValid?"Legal hold ativado e integridade revalidada.":"Legal hold ativado.");
 });

 const applyChangeProposal=(proposal:ChangeProposal)=>act(async()=>{
  const notes=window.prompt("Fundamentação para marcar a mudança como aplicada:","Revisão ativada e evidências conferidas pelo operador.");
  if(notes===null||notes.trim().length<5)throw new Error("Informe a fundamentação.");
  await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}`,{
   method:"PATCH",body:JSON.stringify({status:"APPLIED",notes})
  });
  setMessage("Mudança aplicada; recomendação marcada como implementada.");
 });

 const verifyChangeProposal=(proposal:ChangeProposal)=>act(async()=>{
  const candidates=exercises.filter(ex=>ex.planId===proposal.targetPlanId&&ex.status==="COMPLETED"&&ex.aar?.status==="FINAL")
   .sort((a,b)=>new Date(b.completedAt??b.startedAt).getTime()-new Date(a.completedAt??a.startedAt).getTime());
  const exercise=candidates[0];
  if(!exercise)throw new Error("Conclua um exercício da revisão-alvo e finalize seu AAR antes da verificação.");
  if(!window.confirm(`Usar o exercício de ${new Date(exercise.startedAt).toLocaleString("pt-BR")} para verificar a mudança da revisão v${proposal.targetPlanVersion}?`))return;
  const notes=window.prompt("Conclusão da verificação:","Mudança exercitada na revisão-alvo e AAR finalizado.");
  if(notes===null||notes.trim().length<5)throw new Error("Informe a conclusão da verificação.");
  await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}`,{
   method:"PATCH",body:JSON.stringify({status:"VERIFIED",verificationExerciseId:exercise.id,notes})
  });
  setMessage("Mudança verificada por exercício e AAR da revisão-alvo.");
 });

 const cancelChangeProposal=(proposal:ChangeProposal)=>act(async()=>{
  const notes=window.prompt("Motivo do cancelamento da proposta:","Proposta substituída após reavaliação humana.");
  if(notes===null||notes.trim().length<5)throw new Error("Informe o motivo do cancelamento.");
  await request(`/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}`,{
   method:"PATCH",body:JSON.stringify({status:"CANCELLED",notes})
  });
  setMessage("Proposta cancelada; a recomendação permanece aceita.");
 });
 const finishExercise=(id:string)=>act(async()=>{
  await request("/api/v1/sidec/continuity/exercises/"+id+"/finish",{method:"POST",body:JSON.stringify({notes:finishNotes||null})});
  setFinishNotes("");setMessage("Exercício encerrado e resultado calculado.");
 });

 const cancelExercise=(id:string)=>act(async()=>{
  await request("/api/v1/sidec/continuity/exercises/"+id+"/cancel",{method:"POST",body:JSON.stringify({reason:"Exercício cancelado pelo operador no Centro de Continuidade."})});
  setMessage("Exercício cancelado com registro de auditoria.");
 });

 const active=runbook?.active??null,draft=runbook?.draft??null;
 const activeExercise=exercises.find(x=>x.status==="IN_PROGRESS")??null;
 const governanceParams=[
  governancePeriod.from?`from=${encodeURIComponent(governancePeriod.from+"T00:00:00-03:00")}`:"",
  governancePeriod.to?`to=${encodeURIComponent(governancePeriod.to+"T23:59:59.999-03:00")}`:""
 ].filter(Boolean).join("&");
 const governanceSuffix=governanceParams?"?"+governanceParams:"";

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · CONTINUIDADE SIDEC · v1.41</span><h1>Plano de Continuidade e Runbook</h1><p>Versões controladas, responsáveis nominais e exercícios de mesa auditáveis. Esta tela não executa failover real automaticamente.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/gestao">Centro de Gestão</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>
  {error&&<p className="errorMessage">{error}</p>}{message&&<p className="formMessage">{message}</p>}

  <section className="dataGrid">
   <article className={active?"card":"warningCard"}><h2>Runbook ativo</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{active?"v"+active.version:"Nenhum"}</p><p>{active?.title??"Ative uma revisão antes de iniciar exercícios."}</p></article>
   <article className="card"><h2>Revisão em elaboração</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{draft?"v"+draft.version:"—"}</p><p>{draft?"Editável até a ativação.":"Nenhum rascunho aberto."}</p></article>
   <article className={activeExercise?"warningCard":"card"}><h2>Exercício em andamento</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{activeExercise?activeExercise.summary.progressPct+"%":"Nenhum"}</p><p>{activeExercise?activeExercise.summary.pending+" etapa(s) pendente(s).":"Operação normal."}</p></article>
  </section>

  <section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Agenda periódica de exercícios</h2><p>A agenda sinaliza vencimentos e prepara o cenário; o exercício só inicia por ação humana.</p></div></div>
   <div className="dataGrid">{schedules.length===0?<div className="infoCard">Nenhuma agenda periódica cadastrada.</div>:schedules.map(item=><article className={item.dueState==="OVERDUE"?"warningCard":"card"} key={item.id}><h2>{item.name}</h2><p><strong>{item.dueState==="OVERDUE"?"VENCIDO":item.dueState==="DUE_SOON"?"Próximo":"Programado"}</strong> · a cada {item.intervalDays} dias</p><p>Próximo: {new Date(item.nextDueAt).toLocaleString("pt-BR")}</p><p>Responsável: {item.ownerName??"—"}</p><p>{item.defaultScenario}</p><div className="headerActions">{item.enabled&&!activeExercise&&active&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void startScheduledExercise(item)}>Iniciar exercício agendado</button>}<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void toggleSchedule(item)}>{item.enabled?"Pausar":"Reativar"}</button></div></article>)}</div>
   <div className="incidentForm compactForm" style={{marginTop:12}}>
    <h3>Nova agenda</h3>
    <label>Nome<input value={scheduleDraft.name} onChange={e=>setScheduleDraft(v=>({...v,name:e.target.value}))}/></label>
    <label>Cadência (dias)<input type="number" min="7" max="1095" value={scheduleDraft.intervalDays} onChange={e=>setScheduleDraft(v=>({...v,intervalDays:Number(e.target.value)}))}/></label>
    <label>Próxima data<input type="datetime-local" value={scheduleDraft.nextDueAt} onChange={e=>setScheduleDraft(v=>({...v,nextDueAt:e.target.value}))}/></label>
    <label>Responsável<select value={scheduleDraft.ownerUserId} onChange={e=>setScheduleDraft(v=>({...v,ownerUserId:e.target.value}))}><option value="">Selecionar</option>{(runbook?.operators??[]).map(person=><option key={person.id} value={person.id}>{person.displayName+" · "+person.matricula}</option>)}</select></label>
    <label>Cenário padrão<textarea value={scheduleDraft.defaultScenario} onChange={e=>setScheduleDraft(v=>({...v,defaultScenario:e.target.value}))}/></label>
    <button type="button" className="secondaryLink" disabled={busy||!scheduleDraft.nextDueAt||scheduleDraft.name.trim().length<3} onClick={()=>void createSchedule()}>Criar agenda</button>
   </div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Matriz de escalonamento</h2><p>Contatos internos e externos organizados por nível de acionamento.</p>
   <div className="dataGrid">{contacts.length===0?<div className="infoCard">Nenhum contato cadastrado.</div>:contacts.map(item=><article className={item.active?"card":"infoCard"} key={item.id}><h2>Nível {item.escalationLevel} · {item.name}</h2><p><strong>{item.contactScope}</strong>{item.roleTitle?" · "+item.roleTitle:""}{item.organizationName?" · "+item.organizationName:""}</p><p>{item.channelType}: {item.channelValue}</p>{item.notes&&<p>{item.notes}</p>}<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void toggleContact(item)}>{item.active?"Desativar":"Reativar"}</button></article>)}</div>
   <div className="incidentForm compactForm" style={{marginTop:12}}>
    <h3>Novo contato</h3>
    <label>Escopo<select value={contactDraft.contactScope} onChange={e=>setContactDraft(v=>({...v,contactScope:e.target.value}))}><option value="INTERNAL">Interno</option><option value="EXTERNAL">Externo</option></select></label>
    <label>Nível<input type="number" min="1" max="5" value={contactDraft.escalationLevel} onChange={e=>setContactDraft(v=>({...v,escalationLevel:Number(e.target.value)}))}/></label>
    <label>Nome<input value={contactDraft.name} onChange={e=>setContactDraft(v=>({...v,name:e.target.value}))}/></label>
    <label>Função<input value={contactDraft.roleTitle} onChange={e=>setContactDraft(v=>({...v,roleTitle:e.target.value}))}/></label>
    <label>Organização<input value={contactDraft.organizationName} onChange={e=>setContactDraft(v=>({...v,organizationName:e.target.value}))}/></label>
    <label>Canal<select value={contactDraft.channelType} onChange={e=>setContactDraft(v=>({...v,channelType:e.target.value}))}><option value="PHONE">Telefone</option><option value="EMAIL">E-mail</option><option value="RADIO">Rádio</option><option value="OTHER">Outro</option></select></label>
    <label>Contato<input value={contactDraft.channelValue} onChange={e=>setContactDraft(v=>({...v,channelValue:e.target.value}))}/></label>
    <label>Observações<textarea value={contactDraft.notes} onChange={e=>setContactDraft(v=>({...v,notes:e.target.value}))}/></label>
    <button type="button" className="secondaryLink" disabled={busy||contactDraft.name.trim().length<2||contactDraft.channelValue.trim().length<2} onClick={()=>void createContact()}>Adicionar contato</button>
   </div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Desempenho das ações corretivas</h2><p>Métricas históricas calculadas a partir da execução registrada; a eficácia é sempre avaliada por uma pessoa.</p>
   {actionMetrics&&<div className="dataGrid">
    <article className="card"><h2>Total</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{actionMetrics.summary.total}</p><p>{actionMetrics.summary.done} concluída(s) · {actionMetrics.summary.overdue} vencida(s)</p></article>
    <article className="card"><h2>Tempo médio</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{actionMetrics.summary.avgCompletionHours==null?"—":Number(actionMetrics.summary.avgCompletionHours).toFixed(1)+" h"}</p><p>Da criação até a conclusão.</p></article>
    <article className="card"><h2>No prazo</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{actionMetrics.summary.onTimePct==null?"—":Number(actionMetrics.summary.onTimePct).toFixed(1)+"%"}</p><p>Ações concluídas com prazo definido.</p></article>
    <article className={actionMetrics.summary.ineffective>0?"warningCard":"card"}><h2>Eficácia</h2><p>{actionMetrics.summary.effective} eficaz · {actionMetrics.summary.partial} parcial · {actionMetrics.summary.ineffective} ineficaz</p><p>{actionMetrics.summary.awaitingEffectiveness} concluída(s) aguardando avaliação.</p></article>
    <article className="card"><h2>Integração</h2><p>{actionMetrics.summary.linkedRisks} vinculada(s) a riscos</p><p>{actionMetrics.summary.linkedRecoveryActions} vinculada(s) à recuperação</p></article>
   </div>}
  </section>

  <section style={{marginTop:18}}>
   <h2>Alertas das ações corretivas</h2><p>Avisos automáticos para ações próximas do vencimento ou vencidas; não alteram o status da ação.</p>
   <div className="dataGrid">{actionAlerts.length===0?<div className="infoCard">Nenhuma ação corretiva com alerta aberto.</div>:actionAlerts.map(item=><article className={item.alertType==="OVERDUE"?"warningCard":"card"} key={item.id}><h2>{item.title}</h2><p><strong>{item.alertType==="OVERDUE"?"VENCIDA":"Próxima do vencimento"}</strong> · {item.priority}</p><p>Responsável: {item.ownerName??"—"} · prazo {new Date(item.dueAt).toLocaleString("pt-BR")}</p><p>Runbook v{item.planVersion} · {item.scenario}</p><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void acknowledgeActionAlert(item.id)}>Reconhecer alerta</button></article>)}</div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Lições aprendidas recorrentes</h2><p>Recorrência calculada apenas sobre AARs finalizados e lições estruturadas.</p>
   <div className="dataGrid">{lessonSummary.length===0?<div className="infoCard">Ainda não há lições consolidadas em AARs finais.</div>:lessonSummary.slice(0,12).map(item=><article className={item.occurrences>1?"warningCard":"card"} key={item.recurrenceKey}><h2>{item.recurrenceKey}</h2><p><strong>{item.category}</strong> · {item.occurrences} ocorrência(s)</p><p>{item.titles.join(" · ")}</p><p>Última ocorrência: {new Date(item.lastSeenAt).toLocaleString("pt-BR")}</p></article>)}</div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Recomendações de melhoria do runbook</h2>
   <p>Geradas somente quando a mesma chave de recorrência aparece em pelo menos dois AARs finalizados. Nenhuma recomendação altera o runbook automaticamente.</p>
   <div className="dataGrid">{runbookRecommendations.length===0?<div className="infoCard">Nenhuma recorrência atingiu o limiar para recomendar revisão do runbook.</div>:runbookRecommendations.map(item=><article className={item.severity==="CRITICAL"||item.severity==="HIGH"?"warningCard":"card"} key={item.id}>
    <h2>{item.title}</h2>
    <p><strong>{item.severity}</strong> · {item.status} · {item.occurrences} ocorrência(s)</p>
    <p><strong>Chave:</strong> {item.recurrenceKey} · <strong>Categoria:</strong> {item.category}</p>
    <p>{item.rationale}</p>
    <p>Primeira ocorrência: {new Date(item.firstSeenAt).toLocaleString("pt-BR")} · última: {new Date(item.lastSeenAt).toLocaleString("pt-BR")}</p>
    {item.resolutionNotes&&<p><strong>Fundamentação:</strong> {item.resolutionNotes}{item.resolvedByName?" · "+item.resolvedByName:""}</p>}
    <div className="headerActions">
     {item.status==="OPEN"&&<><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateRecommendation(item,"ACCEPTED")}>Aceitar para revisão</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateRecommendation(item,"DISMISSED")}>Descartar</button></>}
     {item.status==="ACCEPTED"&&(()=>{const activeProposal=changeProposals.find(p=>p.recommendationId===item.id&&p.status!=="CANCELLED");return activeProposal?<span><strong>Proposta:</strong> {activeProposal.status} · runbook v{activeProposal.targetPlanVersion}</span>:<>{runbook?.draft?<button type="button" className="primaryButton" disabled={busy} onClick={()=>void createChangeProposal(item)}>Criar proposta na revisão v{runbook.draft.version}</button>:<button type="button" className="primaryButton" disabled={busy} onClick={()=>void createRevision()}>Criar revisão para tratar</button>}<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateRecommendation(item,"DISMISSED")}>Descartar</button></>})()}
    </div>
   </article>)}</div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Governança e eficácia das mudanças</h2>
   <p>Indicadores do ciclo recomendação → alteração → aplicação → exercício → verificação → selagem → preservação WORM.</p>
   <div className="card" style={{marginBottom:12}}>
    <h2>Política operacional</h2>
    <p>Validade das aprovações críticas: <strong>{changePolicy?.approvalValidHours??168} h</strong> · retenção WORM: <strong>{changePolicy?.reportWormRetentionDays?changePolicy.reportWormRetentionDays+" dias":"sem prazo definido"}</strong> · legal hold: <strong>{changePolicy?.reportWormLegalHold?"ativo":"inativo"}</strong></p>
    <p><small>A política é operacional e não substitui eventual temporalidade legal ou arquivística aplicável.</small></p>
    <button type="button" className="secondaryLink" disabled={busy} onClick={()=>void configureChangePolicy()}>Configurar política</button>
   </div>
   <div className="card" style={{marginBottom:12}}>
    <h2>Delegação temporária de aprovação</h2>
    <p>O substituto decide em nome da autoridade delegante por prazo determinado. O quórum continua exigindo duas autoridades originárias independentes.</p>
    <div className="incidentForm">
     <label>Delegado<select value={delegationDraft.delegateUserId} onChange={e=>setDelegationDraft(v=>({...v,delegateUserId:e.target.value}))}><option value="">Selecionar usuário</option>{(runbook?.operators??[]).map(person=><option key={person.id} value={person.id}>{person.displayName+" · "+person.matricula}</option>)}</select></label>
     <label>Válida até<input type="datetime-local" value={delegationDraft.validUntil} onChange={e=>setDelegationDraft(v=>({...v,validUntil:e.target.value}))}/></label>
     <label>Fundamentação<input value={delegationDraft.reason} onChange={e=>setDelegationDraft(v=>({...v,reason:e.target.value}))}/></label>
     <button type="button" className="secondaryLink" disabled={busy||!delegationDraft.delegateUserId||!delegationDraft.validUntil} onClick={()=>void createApprovalDelegation()}>Criar delegação</button>
    </div>
    {approvalDelegations.filter(item=>item.status==="ACTIVE"||item.status==="SCHEDULED").length===0?<p><small>Nenhuma delegação vigente ou programada.</small></p>:approvalDelegations.filter(item=>item.status==="ACTIVE"||item.status==="SCHEDULED").map(item=><p key={item.id}><small><strong>{item.status}</strong> · {item.delegatorName??item.delegatorMatricula} → {item.delegateName??item.delegateMatricula} · {new Date(item.validFrom).toLocaleString("pt-BR")} até {new Date(item.validUntil).toLocaleString("pt-BR")} · {item.reason} <button type="button" className="secondaryLink" disabled={busy} onClick={()=>void revokeApprovalDelegation(item)}>Revogar</button></small></p>)}
   </div>
   {changeMetrics&&<div className="dataGrid">
    <article className="card"><h2>Total de propostas</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{changeMetrics.summary.total}</p><p>{changeMetrics.summary.proposed} proposta(s) · {changeMetrics.summary.applied} aplicada(s) · {changeMetrics.summary.verified} verificada(s)</p></article>
    <article className="card"><h2>Verificação</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{changeMetrics.summary.verifiedRate==null?"—":Number(changeMetrics.summary.verifiedRate).toFixed(1)+"%"}</p><p>{changeMetrics.summary.sealed} selado(s) · {changeMetrics.summary.archived} em WORM · {changeMetrics.summary.archiveHealthy} íntegro(s) · {changeMetrics.summary.replicated} réplica(s) · {changeMetrics.summary.replicaHealthy} réplica(s) íntegra(s)</p></article>
    <article className={changeMetrics.summary.regressed>0?"warningCard":"card"}><h2>Eficácia</h2><p>{changeMetrics.summary.improved} melhorou · {changeMetrics.summary.stable} estável · {changeMetrics.summary.regressed} regrediu</p><p>{changeMetrics.summary.noBaseline} sem baseline · taxa de melhora {changeMetrics.summary.improvedRate==null?"—":Number(changeMetrics.summary.improvedRate).toFixed(1)+"%"}</p></article>
    <article className={changeMetrics.summary.approvalsExpired>0?"warningCard":"card"}><h2>Governança crítica</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{changeMetrics.summary.critical}</p><p>{changeMetrics.summary.approvalsExpired} aprovação(ões) vencida(s) · {changeMetrics.summary.approvalsExpiring24h} vence(m) em até 24 h · {changeMetrics.summary.activeDelegations} delegação(ões) ativa(s).</p></article>
    <article className={changeMetrics.summary.reportResilienceOpen>0||changeMetrics.summary.reportRestoreFailures30d>0?"warningCard":"card"}><h2>Resiliência dos relatórios</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{changeMetrics.summary.reportResilienceOpen}</p><p>condição(ões) aberta(s) · {changeMetrics.summary.reportRetryPending} retry(ies) pendente(s) · {changeMetrics.summary.reportRestoreFailures30d} falha(s) de restauração em 30 dias.</p></article>
    <article className="card"><h2>Tempo médio</h2><p>Aplicação: {changeMetrics.summary.avgApplyHours==null?"—":Number(changeMetrics.summary.avgApplyHours).toFixed(1)+" h"}</p><p>Aplicação → verificação: {changeMetrics.summary.avgVerificationHours==null?"—":Number(changeMetrics.summary.avgVerificationHours).toFixed(1)+" h"}</p></article>
   </div>}
   {changeMetrics&&changeMetrics.byRecurrence.length>0&&<div style={{marginTop:12}}>
    <h3>Tendências por recorrência</h3>
    <div className="dataGrid">{changeMetrics.byRecurrence.map(item=><article className={item.regressed>0?"warningCard":"card"} key={item.recurrenceKey}>
     <h2>{item.recurrenceKey}</h2>
     <p>{item.proposals} proposta(s) · {item.verified} verificada(s)</p>
     <p>{item.improved} melhorou · {item.regressed} regrediu</p>
     <p><small>Última proposta: {new Date(item.lastProposalAt).toLocaleString("pt-BR")}</small></p>
    </article>)}</div>
   </div>}
  </section>

  <section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Metas e relatório executivo</h2><p>Metas administrativas quantitativas e exportação consolidada de governança. A avaliação exibida usa a janela padrão de 90 dias; o PDF/CSV usa o período selecionado abaixo.</p></div></div>
   <div className="incidentForm">
    <label>Escopo<select value={targetDraft.scopeType} onChange={e=>setTargetDraft(v=>({...v,scopeType:e.target.value as "DEFAULT"|"CATEGORY"|"RECURRENCE",scopeValue:e.target.value==="DEFAULT"?"*":""}))}><option value="DEFAULT">Padrão da organização</option><option value="CATEGORY">Categoria</option><option value="RECURRENCE">Recorrência</option></select></label>
    {targetDraft.scopeType==="CATEGORY"?<label>Categoria<select value={targetDraft.scopeValue} onChange={e=>setTargetDraft(v=>({...v,scopeValue:e.target.value}))}><option value="">Selecionar</option>{["PROCESS","PEOPLE","TECHNOLOGY","COMMUNICATION","DATA","STORAGE","CONNECTIVITY","OTHER"].map(x=><option key={x} value={x}>{x}</option>)}</select></label>:targetDraft.scopeType==="RECURRENCE"?<label>Chave de recorrência<input value={targetDraft.scopeValue} onChange={e=>setTargetDraft(v=>({...v,scopeValue:e.target.value}))}/></label>:null}
    <label>Taxa mínima de verificação (%)<input type="number" min="0" max="100" step="0.1" value={targetDraft.minVerifiedRate} onChange={e=>setTargetDraft(v=>({...v,minVerifiedRate:e.target.value}))}/></label>
    <label>Taxa mínima de melhora (%)<input type="number" min="0" max="100" step="0.1" value={targetDraft.minImprovedRate} onChange={e=>setTargetDraft(v=>({...v,minImprovedRate:e.target.value}))}/></label>
    <label>Tempo máximo até aplicação (h)<input type="number" min="0.1" step="0.1" value={targetDraft.maxAvgApplyHours} onChange={e=>setTargetDraft(v=>({...v,maxAvgApplyHours:e.target.value}))}/></label>
    <label>Tempo máximo aplicação → verificação (h)<input type="number" min="0.1" step="0.1" value={targetDraft.maxAvgVerificationHours} onChange={e=>setTargetDraft(v=>({...v,maxAvgVerificationHours:e.target.value}))}/></label>
    <button type="button" className="primaryButton" disabled={busy} onClick={()=>void saveEffectivenessTarget()}>Salvar meta</button>
   </div>
   <div className="dataGrid" style={{marginTop:12}}>{effectivenessTargets.length===0?<div className="infoCard">Nenhuma meta quantitativa configurada.</div>:effectivenessTargets.map(target=><article className={target.state==="FAIL"?"warningCard":"card"} key={target.scopeType+":"+target.scopeValue}>
    <h2>{target.scopeType+" · "+target.scopeValue}</h2><p><strong>{target.state??"—"}</strong> · {target.actual?.total??0} proposta(s) na janela.</p>
    <p>Verificação {target.actual?.verifiedRate==null?"—":Number(target.actual.verifiedRate).toFixed(1)+"%"}{target.minVerifiedRate!=null?" · meta ≥ "+target.minVerifiedRate+"%":""}</p>
    <p>Melhora {target.actual?.improvedRate==null?"—":Number(target.actual.improvedRate).toFixed(1)+"%"}{target.minImprovedRate!=null?" · meta ≥ "+target.minImprovedRate+"%":""}</p>
    <p>Aplicação {target.actual?.avgApplyHours==null?"—":Number(target.actual.avgApplyHours).toFixed(1)+" h"}{target.maxAvgApplyHours!=null?" · máx. "+target.maxAvgApplyHours+" h":""} · verificação {target.actual?.avgVerificationHours==null?"—":Number(target.actual.avgVerificationHours).toFixed(1)+" h"}{target.maxAvgVerificationHours!=null?" · máx. "+target.maxAvgVerificationHours+" h":""}</p>
    <button type="button" className="secondaryLink" disabled={busy} onClick={()=>void deleteEffectivenessTarget(target)}>Excluir meta</button>
   </article>)}</div>
   <div className="incidentForm" style={{marginTop:12}}>
    <label>Período inicial<input type="date" value={governancePeriod.from} onChange={e=>setGovernancePeriod(v=>({...v,from:e.target.value}))}/></label>
    <label>Período final<input type="date" value={governancePeriod.to} onChange={e=>setGovernancePeriod(v=>({...v,to:e.target.value}))}/></label>
    <div className="headerActions"><a className="primaryButton" href={`${API}/api/v1/sidec/continuity/runbook/governance-report.pdf${governanceSuffix}`}>Baixar relatório executivo PDF</a><a className="secondaryLink" href={`${API}/api/v1/sidec/continuity/runbook/governance-export.csv${governanceSuffix}`}>Exportar CSV</a></div>
   </div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Propostas de mudança controlada</h2>
   <p>A proposta liga uma recomendação aceita a uma revisão específica. O SIGDEC não altera o runbook automaticamente.</p>
   <div className="dataGrid">{changeProposals.length===0?<div className="infoCard">Nenhuma proposta de mudança registrada.</div>:changeProposals.map(proposal=><article className={proposal.status==="PROPOSED"?"warningCard":"card"} key={proposal.id}>
    <h2>{proposal.recommendationTitle}</h2>
    <p><strong>{proposal.status}</strong> · revisão v{proposal.targetPlanVersion} · {proposal.targetPlanStatus} · severidade {proposal.recommendationSeverity}</p>
    <p><strong>Linhagem:</strong> {proposal.basePlanVersion?"v"+proposal.basePlanVersion:"sem baseline"} → v{proposal.targetPlanVersion}</p>
    <p><strong>Recorrência:</strong> {proposal.recurrenceKey}</p>
    <p>{proposal.proposalText}</p>
    <p><strong>Diff:</strong> {proposal.diffSummary.totalChanges} alteração(ões) · {proposal.diffSummary.fieldsChanged} campo(s) gerais · {proposal.diffSummary.stepsAdded} adicionada(s) · {proposal.diffSummary.stepsModified} modificada(s) · {proposal.diffSummary.stepsRemoved} removida(s) · {proposal.diffSummary.stepsSplit??0} divisão(ões) · {proposal.diffSummary.stepsMerged??0} fusão(ões) · {proposal.diffSummary.stepsDerived??0} derivada(s)</p>
    {proposal.status==="PROPOSED"&&proposal.diffSummary.totalChanges===0&&<p><strong>Atenção:</strong> nenhuma alteração estrutural foi detectada entre a revisão-base e o rascunho-alvo.</p>}
    {proposal.effectivenessOutcome&&<p><strong>Eficácia:</strong> {proposal.effectivenessOutcome==="IMPROVED"?"Melhorou":proposal.effectivenessOutcome==="REGRESSED"?"Regrediu":proposal.effectivenessOutcome==="STABLE"?"Estável":"Sem baseline"}{proposal.baselineExerciseResult?" · antes "+proposal.baselineExerciseResult:""}{proposal.verificationExerciseResult?" · depois "+proposal.verificationExerciseResult:""}</p>}
    {proposal.recommendationSeverity==="CRITICAL"&&<p><strong>Dupla aprovação:</strong> {proposal.approvedCount}/2 válidas · {proposal.expiredApprovalCount} vencida(s) · {proposal.rejectedCount} rejeição(ões) · {proposal.criticalApprovalSatisfied?"liberada":"pendente"}</p>}
    {proposal.approvals?.map(item=>{const expired=item.decision==="APPROVED"&&(!item.validUntil||new Date(item.validUntil).getTime()<=Date.now());return <p key={item.id}><small>{item.decision}{expired?" · VENCIDA":""} · {item.decidedByName??"Usuário"}{item.delegated?" · delegado por "+(item.authorityUserName??"autoridade"):""} · decisão {new Date(item.decidedAt).toLocaleString("pt-BR")}{item.validUntil?" · válida até "+new Date(item.validUntil).toLocaleString("pt-BR"):""}{item.revalidatedAt?" · revalidada "+new Date(item.revalidatedAt).toLocaleString("pt-BR"):""} · {item.notes}</small></p>})}
    <p><strong>Evidências:</strong> {proposal.evidence.length}</p>
    {proposal.evidence.slice(-5).map(ev=><p key={ev.id}><small>{ev.evidenceType} · {ev.title} · {ev.reference}</small></p>)}
    {proposal.statusNotes&&<p><strong>Fundamentação:</strong> {proposal.statusNotes}</p>}
    {proposal.appliedAt&&<p>Aplicada em {new Date(proposal.appliedAt).toLocaleString("pt-BR")}{proposal.appliedByName?" · "+proposal.appliedByName:""}</p>}
    {proposal.verifiedAt&&<p>Verificada em {new Date(proposal.verifiedAt).toLocaleString("pt-BR")}{proposal.verifiedByName?" · "+proposal.verifiedByName:""}{proposal.verificationExerciseResult?" · exercício "+proposal.verificationExerciseResult:""}</p>}
    {proposal.reportSealed&&<p><strong>Relatório selado:</strong> {proposal.reportSealedAt?new Date(proposal.reportSealedAt).toLocaleString("pt-BR"):"sim"}{proposal.reportSealedByName?" · "+proposal.reportSealedByName:""} · SHA-256 {proposal.reportHash?.slice(0,16)}… · chave {proposal.reportSealKeyId}</p>}
    {proposal.reportArchived&&<p><strong>WORM:</strong> arquivado em {proposal.reportArchivedAt?new Date(proposal.reportArchivedAt).toLocaleString("pt-BR"):"—"} · {proposal.reportArchiveHealthy?"íntegro":"aguardando/verificação com problema"}{proposal.reportArchiveRetainUntil?" · retenção até "+new Date(proposal.reportArchiveRetainUntil).toLocaleString("pt-BR"):""}{proposal.reportArchiveLegalHold?" · legal hold ativo":""}{proposal.reportArchiveVerifiedAt?" · verificado "+new Date(proposal.reportArchiveVerifiedAt).toLocaleString("pt-BR"):""}</p>}
    {proposal.reportArchiveErrorMessage&&<p><strong>Arquivo WORM:</strong> {proposal.reportArchiveErrorMessage}</p>}
    {proposal.reportReplicaCreated&&<p><strong>Réplica WORM:</strong> {proposal.reportReplicaHealthy?"íntegra":"aguardando/verificação com problema"}{proposal.reportReplicatedAt?" · criada "+new Date(proposal.reportReplicatedAt).toLocaleString("pt-BR"):""}{proposal.reportReplicaRetainUntil?" · retenção até "+new Date(proposal.reportReplicaRetainUntil).toLocaleString("pt-BR"):""}{proposal.reportReplicaLegalHold?" · legal hold ativo":""}{proposal.reportReplicaVerifiedAt?" · verificada "+new Date(proposal.reportReplicaVerifiedAt).toLocaleString("pt-BR"):""}</p>}
    {proposal.reportReplicaErrorMessage&&<p><strong>Réplica WORM:</strong> {proposal.reportReplicaErrorMessage}</p>}
    <div className="headerActions">
     {(proposal.status==="PROPOSED"||proposal.status==="APPLIED")&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void addChangeEvidence(proposal)}>Adicionar evidência</button>}
     {proposal.status==="PROPOSED"&&proposal.recommendationSeverity==="CRITICAL"&&<><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void decideCriticalProposal(proposal,"APPROVED")}>{proposal.expiredApprovalCount>0?"Aprovar / revalidar":"Aprovar mudança crítica"}</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void decideCriticalProposal(proposal,"REJECTED")}>Rejeitar mudança crítica</button></>}
     {proposal.status==="PROPOSED"&&proposal.targetPlanStatus!=="DRAFT"&&proposal.evidence.length>0&&proposal.diffSummary.totalChanges>0&&proposal.criticalApprovalSatisfied&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void applyChangeProposal(proposal)}>Confirmar aplicação</button>}
     {proposal.status==="PROPOSED"&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void cancelChangeProposal(proposal)}>Cancelar proposta</button>}
     {proposal.status==="APPLIED"&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void verifyChangeProposal(proposal)}>Verificar por exercício/AAR</button>}
     {proposal.status==="VERIFIED"&&!proposal.reportSealed&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void sealChangeReport(proposal)}>Selar relatório</button>}
     {proposal.reportSealed&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void verifyChangeReportSeal(proposal)}>Verificar selo</button>}
     {proposal.reportSealed&&!proposal.reportArchived&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void archiveChangeReport(proposal)}>Arquivar no WORM</button>}
     {proposal.reportArchived&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void verifyArchivedChangeReport(proposal)}>Verificar WORM</button>}
     {proposal.reportArchived&&!proposal.reportReplicaCreated&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void replicateChangeReport(proposal)}>Criar réplica WORM</button>}
     {proposal.reportReplicaCreated&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void verifyChangeReportReplica(proposal)}>Verificar réplica</button>}
     {proposal.reportReplicaCreated&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void syncChangeReportReplica(proposal)}>Sincronizar réplica</button>}
     {proposal.reportArchived&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void runChangeReportDrill(proposal,"PRIMARY")}>Drill WORM principal</button>}
     {proposal.reportReplicaCreated&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void runChangeReportDrill(proposal,"REPLICA")}>Drill réplica</button>}
     {proposal.reportArchived&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void extendChangeReportRetention(proposal)}>Ampliar retenção</button>}
     {proposal.reportArchived&&!proposal.reportArchiveLegalHold&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void enableChangeReportLegalHold(proposal)}>Ativar legal hold</button>}
     <a className="secondaryLink" href={`${API}/api/v1/sidec/continuity/runbook/change-proposals/${proposal.id}/report.pdf`}>{proposal.reportSealed?"Relatório selado PDF":"Relatório da mudança PDF"}</a>
    </div>
   </article>)}</div>
  </section>

  <section style={{marginTop:18}}>
   <h2>Histórico de eficácia por recorrência</h2>
   <p>Compara ações corretivas relacionadas à mesma causa recorrente ao longo de diferentes exercícios e versões do runbook.</p>
   <div className="dataGrid">{effectivenessHistory.length===0?<div className="infoCard">Ainda não há histórico de ações com chave de recorrência.</div>:effectivenessHistory.map(group=><article className="card" key={group.recurrenceKey}>
    <h2>{group.recurrenceKey}</h2>
    <p>{group.history.length} ação(ões) registrada(s) em {new Set(group.history.map(item=>item.exerciseId)).size} exercício(s).</p>
    {group.history.slice(-8).map(item=><p key={item.actionId}><small>Runbook v{item.planVersion} · {new Date(item.startedAt).toLocaleDateString("pt-BR")} · {item.title} · {item.status} · eficácia {item.effectiveness}{item.effectivenessNotes?" · "+item.effectivenessNotes:""}</small></p>)}
   </article>)}</div>
  </section>

  <section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Revisões do runbook</h2><p>Revisões ativas e históricas são imutáveis; somente o rascunho pode ser editado.</p></div>{!draft&&<button className="primaryButton" disabled={busy} type="button" onClick={()=>void createRevision()}>{active?"Criar nova revisão":"Criar runbook inicial"}</button>}</div>

   {draft&&<div className="incidentForm">
    <h2>Rascunho v{draft.version}</h2>
    <label>Título<input value={draft.title} onChange={e=>patchDraft({title:e.target.value})}/></label>
    <label>Critérios de ativação<textarea value={draft.activationCriteria} onChange={e=>patchDraft({activationCriteria:e.target.value})}/></label>
    <label>Estratégia de recuperação<textarea value={draft.recoveryStrategy} onChange={e=>patchDraft({recoveryStrategy:e.target.value})}/></label>
    <label>Plano de comunicação<textarea value={draft.communicationPlan} onChange={e=>patchDraft({communicationPlan:e.target.value})}/></label>
    <label>Retorno à normalidade<textarea value={draft.returnToNormal} onChange={e=>patchDraft({returnToNormal:e.target.value})}/></label>
    <div className="dataGrid">
     {draft.steps.map((step,index)=><article className="card" key={step.id??step.sortOrder}>
      <h2>{phaseLabels[step.phase]??step.phase}</h2>
      <label>Título<input value={step.title} onChange={e=>patchStep(index,{title:e.target.value})}/></label>
      <label>Instruções<textarea value={step.instructions} onChange={e=>patchStep(index,{instructions:e.target.value})}/></label>
      <label>Responsável<select value={step.ownerUserId??""} onChange={e=>patchStep(index,{ownerUserId:e.target.value||null})}><option value="">Selecionar responsável</option>{(runbook?.operators??[]).map(person=><option key={person.id} value={person.id}>{person.displayName+" · "+person.matricula+(person.jobTitle?" · "+person.jobTitle:"")}</option>)}</select></label>
      <label>Tempo esperado (min)<input type="number" min="1" max="10080" value={step.expectedMinutes} onChange={e=>patchStep(index,{expectedMinutes:Number(e.target.value)})}/></label>
      <label>Obrigatoriedade<select value={step.required?"required":"optional"} onChange={e=>patchStep(index,{required:e.target.value==="required"})}><option value="required">Obrigatória</option><option value="optional">Opcional</option></select></label>
      {step.sourceLineageKeys?.length?<p><small><strong>Linhagem múltipla:</strong> derivada de {step.sourceLineageKeys.length} etapa(s) da revisão-base.</small></p>:step.lineageKey?<p><small>Identidade preservada entre revisões.</small></p>:null}
      <div className="headerActions"><button type="button" className="secondaryLink" disabled={busy||draft.steps.length>=80} onClick={()=>splitDraftStep(index)}>Dividir etapa</button>{index<draft.steps.length-1&&<button type="button" className="secondaryLink" disabled={busy||draft.steps.length<=6} onClick={()=>mergeDraftStepWithNext(index)}>Fundir com próxima</button>}</div>
     </article>)}
    </div>
    <div className="headerActions"><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void saveDraft()}>Salvar rascunho</button><button type="button" className="primaryButton" disabled={busy} onClick={()=>void activateDraft()}>Validar e ativar</button></div>
   </div>}

   {active&&<article className="card" style={{marginTop:14}}>
    <h2>{active.title+" · v"+active.version}</h2>
    <p><strong>Ativada:</strong> {active.activatedAt?new Date(active.activatedAt).toLocaleString("pt-BR"):"—"}{active.activatedByName?" · "+active.activatedByName:""}</p>
    <p><strong>Critérios:</strong> {active.activationCriteria}</p><p><strong>Estratégia:</strong> {active.recoveryStrategy}</p><p><strong>Comunicação:</strong> {active.communicationPlan}</p><p><strong>Retorno:</strong> {active.returnToNormal}</p>
    <div className="dataGrid">{active.steps.map(step=><article className="card" key={step.id}><h2>{phaseLabels[step.phase]??step.phase}</h2><p><strong>{step.title}</strong></p><p>{step.instructions}</p><p>{"Responsável: "+(step.ownerName??"Não definido")+(step.ownerMatricula?" · matrícula "+step.ownerMatricula:"")+" · previsão "+step.expectedMinutes+" min"}</p></article>)}</div>
   </article>}
  </section>

  <section style={{marginTop:18}}>
   <h2>Exercícios de mesa</h2><p>O checklist registra decisões e evidências; não altera infraestrutura, DNS, storage, banco ou serviços externos.</p>
   {!activeExercise&&active&&<div className="incidentForm compactForm"><label>Cenário<textarea value={scenario} onChange={e=>setScenario(e.target.value)}/></label><button type="button" className="primaryButton" disabled={busy} onClick={()=>void startExercise()}>Iniciar exercício controlado</button></div>}
   {activeExercise&&<div className="incidentForm">
    <h2>{"Exercício em andamento · Runbook v"+activeExercise.planVersion}</h2><p>{activeExercise.scenario}</p><p><strong>Progresso:</strong> {activeExercise.summary.progressPct}% · pendentes {activeExercise.summary.pending} · falhas {activeExercise.summary.failed}</p>
    <div className="dataGrid">{activeExercise.steps.map(step=>{const evidence=evidenceDrafts[step.stepId]??{evidenceType:"NOTE" as const,title:"",reference:"",contentHash:""};return <article className={step.status==="FAILED"?"warningCard":"card"} key={step.stepId}><h2>{phaseLabels[step.phase]??step.phase}</h2><p><strong>{step.title}</strong></p><p>{step.instructions}</p><p>{"Responsável previsto: "+(step.ownerName??"—")+" · "+step.expectedMinutes+" min · "+step.status}</p><label>Observações da etapa<textarea value={stepNotes[step.stepId]??step.notes??""} onChange={e=>setStepNotes(v=>({...v,[step.stepId]:e.target.value}))}/></label><div className="headerActions"><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"COMPLETED")}>Concluir</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"SKIPPED")}>Pular</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"FAILED")}>Falha</button>{step.status!=="PENDING"&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"PENDING")}>Reabrir</button>}</div><div style={{marginTop:10}}><strong>Evidências ({step.evidence?.length??0})</strong>{(step.evidence??[]).map(ev=><p key={ev.id}><small>{ev.evidenceType} · {ev.title}: {ev.reference}{ev.contentHash?` · SHA-256 ${ev.contentHash}`:""}</small></p>)}<label>Tipo<select value={evidence.evidenceType} onChange={e=>setEvidenceDrafts(v=>({...v,[step.stepId]:{...evidence,evidenceType:e.target.value as Evidence["evidenceType"]}}))}><option value="NOTE">Nota</option><option value="LINK">Link</option><option value="DOCUMENT">Documento</option><option value="HASH">Hash</option></select></label><label>Título<input value={evidence.title} onChange={e=>setEvidenceDrafts(v=>({...v,[step.stepId]:{...evidence,title:e.target.value}}))}/></label><label>Referência<textarea value={evidence.reference} onChange={e=>setEvidenceDrafts(v=>({...v,[step.stepId]:{...evidence,reference:e.target.value}}))}/></label><label>SHA-256 opcional<input value={evidence.contentHash} onChange={e=>setEvidenceDrafts(v=>({...v,[step.stepId]:{...evidence,contentHash:e.target.value.trim().toLowerCase()}}))}/></label><button type="button" className="secondaryLink" disabled={busy||evidence.title.trim().length<3||!evidence.reference.trim()} onClick={()=>void addEvidence(activeExercise.id,step.stepId)}>Registrar evidência</button></div></article>})}</div>
    <label>Observações de encerramento<textarea value={finishNotes} onChange={e=>setFinishNotes(e.target.value)}/></label><div className="headerActions"><button type="button" className="primaryButton" disabled={busy||activeExercise.summary.requiredPending>0} onClick={()=>void finishExercise(activeExercise.id)}>Encerrar e calcular resultado</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void cancelExercise(activeExercise.id)}>Cancelar exercício</button></div>
   </div>}
   <div className="dataGrid" style={{marginTop:14}}>{exercises.filter(x=>x.status!=="IN_PROGRESS").slice(0,12).map(ex=><article className={ex.result==="FAIL"?"warningCard":"card"} key={ex.id}><h2>{"Runbook v"+ex.planVersion+" · "+ex.status}</h2><p><strong>{ex.result?resultLabels[ex.result]??ex.result:"Sem resultado"}</strong> · {new Date(ex.startedAt).toLocaleString("pt-BR")}</p><p>{ex.scenario}</p><p>Concluídas {ex.summary.completed}/{ex.summary.total} · puladas {ex.summary.skipped} · falhas {ex.summary.failed}</p>{ex.notes&&<p>{ex.notes}</p>}<div className="headerActions"><a className="secondaryLink" href={`${API}/api/v1/sidec/continuity/exercises/${ex.id}/report.pdf`}>Baixar relatório PDF</a>{ex.status==="COMPLETED"&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>openAar(ex)}>Abrir AAR</button>}</div></article>)}</div>
  </section>

  {selectedExerciseId&&(()=>{const ex=exercises.find(x=>x.id===selectedExerciseId);if(!ex)return null;const aar=ex.aar;return <section style={{marginTop:18}}><div className="listHeader"><div><h2>After Action Review · Runbook v{ex.planVersion}</h2><p>{ex.scenario}</p></div><a className="secondaryLink" href={`${API}/api/v1/sidec/continuity/exercises/${ex.id}/report.pdf`}>Relatório PDF</a></div><div className="incidentForm"><label>Resumo executivo<textarea disabled={aar?.status==="FINAL"} value={aarDraft.executiveSummary} onChange={e=>setAarDraft(v=>({...v,executiveSummary:e.target.value}))}/></label><label>Pontos fortes<textarea disabled={aar?.status==="FINAL"} value={aarDraft.strengths} onChange={e=>setAarDraft(v=>({...v,strengths:e.target.value}))}/></label><label>Lacunas<textarea disabled={aar?.status==="FINAL"} value={aarDraft.gaps} onChange={e=>setAarDraft(v=>({...v,gaps:e.target.value}))}/></label><label>Recomendações<textarea disabled={aar?.status==="FINAL"} value={aarDraft.recommendations} onChange={e=>setAarDraft(v=>({...v,recommendations:e.target.value}))}/></label>{aar?.status!=="FINAL"&&<div className="headerActions"><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void saveAar()}>Salvar AAR</button>{aar&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void finalizeAar()}>Finalizar AAR</button>}</div>}</div>{aar&&<><h3>Ações corretivas</h3><div className="dataGrid">{aar.actions.map(action=><article className={(action.priority==="CRITICAL"&&action.status!=="DONE")||action.effectiveness==="INEFFECTIVE"?"warningCard":"card"} key={action.id}><h2>{action.title}</h2><p><strong>{action.priority}</strong> · {action.status}</p><p>{action.description}</p><p>Responsável: {action.ownerName??"—"} · prazo {action.dueAt?new Date(action.dueAt).toLocaleDateString("pt-BR"):"—"}</p>{action.recurrenceKey&&<p><strong>Recorrência:</strong> {action.recurrenceKey}</p>}{action.riskId&&<p><strong>Risco:</strong> {action.riskCode??""} · {action.riskTitle??action.riskId}</p>}{action.recoveryActionId&&<p><strong>Recuperação:</strong> {action.recoveryActionTitle??action.recoveryActionId}{action.recoveryActionStatus?" · "+action.recoveryActionStatus:""}</p>}{action.status==="DONE"&&<p><strong>Eficácia:</strong> {action.effectiveness==="NOT_EVALUATED"?"Aguardando avaliação":action.effectiveness}{action.effectivenessNotes?" · "+action.effectivenessNotes:""}</p>}<div className="headerActions">{action.status!=="DONE"&&action.status!=="CANCELLED"&&<><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateActionStatus(ex.id,action.id,"IN_PROGRESS")}>Em andamento</button><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateActionStatus(ex.id,action.id,"DONE")}>Concluir</button></>}{aar.status==="FINAL"&&!action.recoveryActionId&&action.status!=="CANCELLED"&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void promoteRecovery(ex.id,action)}>Promover para recuperação</button>}</div>{action.status==="DONE"&&<div className="incidentForm compactForm" style={{marginTop:10}}><strong>Avaliação de eficácia</strong><label>Resultado<select value={effectivenessDrafts[action.id]?.effectiveness??(action.effectiveness==="NOT_EVALUATED"?"EFFECTIVE":action.effectiveness)} onChange={e=>setEffectivenessDrafts(v=>({...v,[action.id]:{effectiveness:e.target.value as "EFFECTIVE"|"PARTIAL"|"INEFFECTIVE",notes:v[action.id]?.notes??action.effectivenessNotes??""}}))}><option value="EFFECTIVE">Eficaz</option><option value="PARTIAL">Parcial</option><option value="INEFFECTIVE">Ineficaz</option></select></label><label>Fundamentação<textarea value={effectivenessDrafts[action.id]?.notes??action.effectivenessNotes??""} onChange={e=>setEffectivenessDrafts(v=>({...v,[action.id]:{effectiveness:v[action.id]?.effectiveness??(action.effectiveness==="NOT_EVALUATED"?"EFFECTIVE":action.effectiveness as "EFFECTIVE"|"PARTIAL"|"INEFFECTIVE"),notes:e.target.value}}))}/></label><button type="button" className="secondaryLink" disabled={busy||(effectivenessDrafts[action.id]?.notes??action.effectivenessNotes??"").trim().length<5} onClick={()=>void evaluateActionEffectiveness(ex.id,action)}>Registrar eficácia</button></div>}</article>)}</div>{aar.status==="DRAFT"&&<div className="incidentForm compactForm"><h3>Nova lição aprendida</h3><label>Categoria<select value={lessonDraft.category} onChange={e=>setLessonDraft(v=>({...v,category:e.target.value}))}><option value="PROCESS">Processo</option><option value="PEOPLE">Pessoas</option><option value="TECHNOLOGY">Tecnologia</option><option value="COMMUNICATION">Comunicação</option><option value="DATA">Dados</option><option value="STORAGE">Storage</option><option value="CONNECTIVITY">Conectividade</option><option value="OTHER">Outro</option></select></label><label>Chave de recorrência<input placeholder="ex.: contato.desatualizado" value={lessonDraft.recurrenceKey} onChange={e=>setLessonDraft(v=>({...v,recurrenceKey:e.target.value.trim().toLowerCase().replace(/\s+/g,"-")}))}/></label><label>Título<input value={lessonDraft.title} onChange={e=>setLessonDraft(v=>({...v,title:e.target.value}))}/></label><label>Observação<textarea value={lessonDraft.observation} onChange={e=>setLessonDraft(v=>({...v,observation:e.target.value}))}/></label><label>Severidade<select value={lessonDraft.severity} onChange={e=>setLessonDraft(v=>({...v,severity:e.target.value}))}><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label><button type="button" className="secondaryLink" disabled={busy||lessonDraft.recurrenceKey.length<2||lessonDraft.title.trim().length<3||lessonDraft.observation.trim().length<5} onClick={()=>void addLesson()}>Adicionar lição</button>{(aar.lessons??lessonRecent.filter(l=>l.exerciseId===ex.id)).map(l=><p key={l.id}><small>{l.category} · {l.recurrenceKey} · {l.title}</small></p>)}</div>}{aar.status==="DRAFT"&&<div className="incidentForm compactForm"><h3>Nova ação corretiva</h3><label>Título<input value={actionDraft.title} onChange={e=>setActionDraft(v=>({...v,title:e.target.value}))}/></label><label>Descrição<textarea value={actionDraft.description} onChange={e=>setActionDraft(v=>({...v,description:e.target.value}))}/></label><label>Prioridade<select value={actionDraft.priority} onChange={e=>setActionDraft(v=>({...v,priority:e.target.value}))}><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label><label>Responsável<select value={actionDraft.ownerUserId} onChange={e=>setActionDraft(v=>({...v,ownerUserId:e.target.value}))}><option value="">Selecionar</option>{(runbook?.operators??[]).map(person=><option key={person.id} value={person.id}>{person.displayName+" · "+person.matricula}</option>)}</select></label><label>Prazo<input type="date" value={actionDraft.dueAt} onChange={e=>setActionDraft(v=>({...v,dueAt:e.target.value}))}/></label><label>Risco relacionado<select value={actionDraft.riskId} onChange={e=>setActionDraft(v=>({...v,riskId:e.target.value}))}><option value="">Sem vínculo</option>{riskReferences.map(risk=><option key={risk.id} value={risk.id}>{risk.code+" · "+risk.title+" · score "+(risk.probability*risk.impact)}</option>)}</select></label><label>Ação de recuperação relacionada<select value={actionDraft.recoveryActionId} onChange={e=>setActionDraft(v=>({...v,recoveryActionId:e.target.value}))}><option value="">Sem vínculo</option>{recoveryReferences.map(item=><option key={item.id} value={item.id}>{item.title+" · "+item.status}</option>)}</select></label><label>Chave de recorrência<input placeholder="ex.: storage.replica-indisponivel" value={actionDraft.recurrenceKey} onChange={e=>setActionDraft(v=>({...v,recurrenceKey:e.target.value.trim().toLowerCase().replace(/\s+/g,"-")}))}/></label><button type="button" className="secondaryLink" disabled={busy||actionDraft.title.trim().length<3} onClick={()=>void addAarAction()}>Adicionar ação</button></div>}</>}</section>})()}

  <section style={{marginTop:18}}><h2>Histórico de versões</h2><div className="dataGrid">{(runbook?.revisions??[]).map(item=><article className="card" key={item.id}><h2>{"v"+item.version+" · "+item.status}</h2><p>{item.title}</p><p>Atualizada em {new Date(item.updatedAt).toLocaleString("pt-BR")}</p></article>)}</div></section>
 </main>
}
