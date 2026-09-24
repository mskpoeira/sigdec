"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Operator={id:string;matricula:string;displayName:string;jobTitle?:string|null};
type RunbookStep={id?:string;phase:"DECLARATION"|"COMMUNICATION"|"PRESERVATION"|"RECOVERY"|"VALIDATION"|"RETURN";sortOrder:number;title:string;instructions:string;expectedMinutes:number;ownerUserId?:string|null;ownerName?:string|null;ownerMatricula?:string|null;required:boolean};
type RunbookPlan={id:string;version:number;title:string;status:"DRAFT"|"ACTIVE"|"RETIRED";activationCriteria:string;recoveryStrategy:string;communicationPlan:string;returnToNormal:string;updatedAt:string;activatedAt?:string|null;activatedByName?:string|null;steps:RunbookStep[]};
type RunbookData={active:RunbookPlan|null;draft:RunbookPlan|null;revisions:Array<{id:string;version:number;title:string;status:string;updatedAt:string}>;operators:Operator[]};
type Evidence={id:string;evidenceType:"NOTE"|"LINK"|"DOCUMENT"|"HASH";title:string;reference:string;contentHash?:string|null;createdAt:string;createdByName?:string|null};
type ExerciseStep={stepId:string;phase:string;title:string;instructions:string;expectedMinutes:number;required:boolean;ownerName?:string|null;status:"PENDING"|"COMPLETED"|"SKIPPED"|"FAILED";notes?:string|null;evidence:Evidence[]};
type AarAction={id:string;title:string;description?:string|null;priority:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";ownerUserId?:string|null;ownerName?:string|null;dueAt?:string|null;status:"OPEN"|"IN_PROGRESS"|"DONE"|"CANCELLED";completedAt?:string|null;riskId?:string|null;riskCode?:string|null;riskTitle?:string|null;recoveryActionId?:string|null;recoveryActionTitle?:string|null;recoveryActionStatus?:string|null;effectiveness:"NOT_EVALUATED"|"EFFECTIVE"|"PARTIAL"|"INEFFECTIVE";effectivenessNotes?:string|null;effectivenessEvaluatedAt?:string|null;effectivenessEvaluatedByName?:string|null};
type Aar={id:string;status:"DRAFT"|"FINAL";executiveSummary:string;strengths:string;gaps:string;recommendations:string;finalizedAt?:string|null;finalizedByName?:string|null;actions:AarAction[];lessons?:Array<{id:string;category:string;recurrenceKey:string;title:string;observation:string;severity:string;createdAt:string}>};
type Exercise={id:string;planVersion:number;planTitle:string;scenario:string;status:"IN_PROGRESS"|"COMPLETED"|"CANCELLED";result?:"PASS"|"PARTIAL"|"FAIL"|null;notes?:string|null;startedAt:string;completedAt?:string|null;summary:{total:number;completed:number;skipped:number;failed:number;pending:number;requiredPending:number;progressPct:number};steps:ExerciseStep[];aar?:Aar|null};
type ContinuitySchedule={id:string;name:string;intervalDays:number;nextDueAt:string;defaultScenario:string;ownerUserId?:string|null;ownerName?:string|null;enabled:boolean;lastExerciseId?:string|null;dueState:"SCHEDULED"|"DUE_SOON"|"OVERDUE"|"DISABLED"};
type ContinuityContact={id:string;contactScope:"INTERNAL"|"EXTERNAL";escalationLevel:number;name:string;roleTitle?:string|null;organizationName?:string|null;channelType:"PHONE"|"EMAIL"|"RADIO"|"OTHER";channelValue:string;notes?:string|null;active:boolean};
type ActionAlert={id:string;actionId:string;alertType:"DUE_SOON"|"OVERDUE";dueAt:string;detectedAt:string;title:string;priority:string;status:string;ownerName?:string|null;exerciseId:string;scenario:string;planVersion:number};
type LessonSummary={recurrenceKey:string;category:string;occurrences:number;lastSeenAt:string;titles:string[]};
type LessonRecent={id:string;category:string;recurrenceKey:string;title:string;observation:string;severity:string;createdAt:string;exerciseId:string;planVersion:number};
type RiskReference={id:string;code:string;title:string;category:string;status:string;probability:number;impact:number};
type RecoveryReference={id:string;title:string;category:string;status:string;responsible?:string|null;dueAt?:string|null};
type ActionMetrics={summary:{total:number;done:number;overdue:number;linkedRisks:number;linkedRecoveryActions:number;avgCompletionHours?:number|null;onTimePct?:number|null;effective:number;partial:number;ineffective:number;awaitingEffectiveness:number};byPriority:Array<{priority:string;total:number;done:number;avgCompletionHours?:number|null}>};

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
 const [scheduleDraft,setScheduleDraft]=useState({name:"Exercício periódico SIDEC",intervalDays:90,nextDueAt:"",defaultScenario:"Exercício periódico de mesa para validar o Plano de Continuidade SIDEC e as evidências operacionais.",ownerUserId:""});
 const [contactDraft,setContactDraft]=useState({contactScope:"EXTERNAL",escalationLevel:1,name:"",roleTitle:"",organizationName:"",channelType:"PHONE",channelValue:"",notes:""});
 const [lessonDraft,setLessonDraft]=useState({category:"PROCESS",recurrenceKey:"",title:"",observation:"",severity:"MEDIUM"});
 const [scenario,setScenario]=useState("Exercício de mesa para validar o Plano de Continuidade SIDEC, responsáveis, preservação, recuperação, validação e retorno à normalidade.");
 const [finishNotes,setFinishNotes]=useState("");
 const [stepNotes,setStepNotes]=useState<Record<string,string>>({});
 const [evidenceDrafts,setEvidenceDrafts]=useState<Record<string,{evidenceType:"NOTE"|"LINK"|"DOCUMENT"|"HASH";title:string;reference:string;contentHash:string}>>({});
 const [selectedExerciseId,setSelectedExerciseId]=useState<string|null>(null);
 const [aarDraft,setAarDraft]=useState({executiveSummary:"",strengths:"",gaps:"",recommendations:""});
 const [actionDraft,setActionDraft]=useState({title:"",description:"",priority:"MEDIUM",ownerUserId:"",dueAt:"",riskId:"",recoveryActionId:""});
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
   const [r,e,s,cnt,aa,ls,refs,metrics]=await Promise.all([
    request("/api/v1/sidec/continuity/runbook"),
    request("/api/v1/sidec/continuity/exercises"),
    request("/api/v1/sidec/continuity/schedules"),
    request("/api/v1/sidec/continuity/contacts"),
    request("/api/v1/sidec/continuity/action-alerts"),
    request("/api/v1/sidec/continuity/lessons"),
    request("/api/v1/sidec/continuity/action-references"),
    request("/api/v1/sidec/continuity/actions/metrics")
   ]);
   if(r)setRunbook(r);
   if(e)setExercises(e.items??[]);
   if(s)setSchedules(s.items??[]);
   if(cnt)setContacts(cnt.items??[]);
   if(aa)setActionAlerts(aa.items??[]);
   if(ls){setLessonSummary(ls.summary??[]);setLessonRecent(ls.recent??[]);}
   if(refs){setRiskReferences(refs.risks??[]);setRecoveryReferences(refs.recoveryActions??[]);}
   if(metrics)setActionMetrics(metrics);
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
    steps:draft.steps.map(step=>({phase:step.phase,sortOrder:step.sortOrder,title:step.title,instructions:step.instructions,expectedMinutes:step.expectedMinutes,ownerUserId:step.ownerUserId||null,required:step.required}))
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
   riskId:actionDraft.riskId||null,recoveryActionId:actionDraft.recoveryActionId||null
  })});
  setActionDraft({title:"",description:"",priority:"MEDIUM",ownerUserId:"",dueAt:"",riskId:"",recoveryActionId:""});
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

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · CONTINUIDADE SIDEC · v1.29</span><h1>Plano de Continuidade e Runbook</h1><p>Versões controladas, responsáveis nominais e exercícios de mesa auditáveis. Esta tela não executa failover real automaticamente.</p></div>
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

  {selectedExerciseId&&(()=>{const ex=exercises.find(x=>x.id===selectedExerciseId);if(!ex)return null;const aar=ex.aar;return <section style={{marginTop:18}}><div className="listHeader"><div><h2>After Action Review · Runbook v{ex.planVersion}</h2><p>{ex.scenario}</p></div><a className="secondaryLink" href={`${API}/api/v1/sidec/continuity/exercises/${ex.id}/report.pdf`}>Relatório PDF</a></div><div className="incidentForm"><label>Resumo executivo<textarea disabled={aar?.status==="FINAL"} value={aarDraft.executiveSummary} onChange={e=>setAarDraft(v=>({...v,executiveSummary:e.target.value}))}/></label><label>Pontos fortes<textarea disabled={aar?.status==="FINAL"} value={aarDraft.strengths} onChange={e=>setAarDraft(v=>({...v,strengths:e.target.value}))}/></label><label>Lacunas<textarea disabled={aar?.status==="FINAL"} value={aarDraft.gaps} onChange={e=>setAarDraft(v=>({...v,gaps:e.target.value}))}/></label><label>Recomendações<textarea disabled={aar?.status==="FINAL"} value={aarDraft.recommendations} onChange={e=>setAarDraft(v=>({...v,recommendations:e.target.value}))}/></label>{aar?.status!=="FINAL"&&<div className="headerActions"><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void saveAar()}>Salvar AAR</button>{aar&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>void finalizeAar()}>Finalizar AAR</button>}</div>}</div>{aar&&<><h3>Ações corretivas</h3><div className="dataGrid">{aar.actions.map(action=><article className={(action.priority==="CRITICAL"&&action.status!=="DONE")||action.effectiveness==="INEFFECTIVE"?"warningCard":"card"} key={action.id}><h2>{action.title}</h2><p><strong>{action.priority}</strong> · {action.status}</p><p>{action.description}</p><p>Responsável: {action.ownerName??"—"} · prazo {action.dueAt?new Date(action.dueAt).toLocaleDateString("pt-BR"):"—"}</p>{action.riskId&&<p><strong>Risco:</strong> {action.riskCode??""} · {action.riskTitle??action.riskId}</p>}{action.recoveryActionId&&<p><strong>Recuperação:</strong> {action.recoveryActionTitle??action.recoveryActionId}{action.recoveryActionStatus?" · "+action.recoveryActionStatus:""}</p>}{action.status==="DONE"&&<p><strong>Eficácia:</strong> {action.effectiveness==="NOT_EVALUATED"?"Aguardando avaliação":action.effectiveness}{action.effectivenessNotes?" · "+action.effectivenessNotes:""}</p>}<div className="headerActions">{action.status!=="DONE"&&action.status!=="CANCELLED"&&<><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateActionStatus(ex.id,action.id,"IN_PROGRESS")}>Em andamento</button><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateActionStatus(ex.id,action.id,"DONE")}>Concluir</button></>}</div>{action.status==="DONE"&&<div className="incidentForm compactForm" style={{marginTop:10}}><strong>Avaliação de eficácia</strong><label>Resultado<select value={effectivenessDrafts[action.id]?.effectiveness??(action.effectiveness==="NOT_EVALUATED"?"EFFECTIVE":action.effectiveness)} onChange={e=>setEffectivenessDrafts(v=>({...v,[action.id]:{effectiveness:e.target.value as "EFFECTIVE"|"PARTIAL"|"INEFFECTIVE",notes:v[action.id]?.notes??action.effectivenessNotes??""}}))}><option value="EFFECTIVE">Eficaz</option><option value="PARTIAL">Parcial</option><option value="INEFFECTIVE">Ineficaz</option></select></label><label>Fundamentação<textarea value={effectivenessDrafts[action.id]?.notes??action.effectivenessNotes??""} onChange={e=>setEffectivenessDrafts(v=>({...v,[action.id]:{effectiveness:v[action.id]?.effectiveness??(action.effectiveness==="NOT_EVALUATED"?"EFFECTIVE":action.effectiveness as "EFFECTIVE"|"PARTIAL"|"INEFFECTIVE"),notes:e.target.value}}))}/></label><button type="button" className="secondaryLink" disabled={busy||(effectivenessDrafts[action.id]?.notes??action.effectivenessNotes??"").trim().length<5} onClick={()=>void evaluateActionEffectiveness(ex.id,action)}>Registrar eficácia</button></div>}</article>)}</div>{aar.status==="DRAFT"&&<div className="incidentForm compactForm"><h3>Nova lição aprendida</h3><label>Categoria<select value={lessonDraft.category} onChange={e=>setLessonDraft(v=>({...v,category:e.target.value}))}><option value="PROCESS">Processo</option><option value="PEOPLE">Pessoas</option><option value="TECHNOLOGY">Tecnologia</option><option value="COMMUNICATION">Comunicação</option><option value="DATA">Dados</option><option value="STORAGE">Storage</option><option value="CONNECTIVITY">Conectividade</option><option value="OTHER">Outro</option></select></label><label>Chave de recorrência<input placeholder="ex.: contato.desatualizado" value={lessonDraft.recurrenceKey} onChange={e=>setLessonDraft(v=>({...v,recurrenceKey:e.target.value.trim().toLowerCase().replace(/\s+/g,"-")}))}/></label><label>Título<input value={lessonDraft.title} onChange={e=>setLessonDraft(v=>({...v,title:e.target.value}))}/></label><label>Observação<textarea value={lessonDraft.observation} onChange={e=>setLessonDraft(v=>({...v,observation:e.target.value}))}/></label><label>Severidade<select value={lessonDraft.severity} onChange={e=>setLessonDraft(v=>({...v,severity:e.target.value}))}><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label><button type="button" className="secondaryLink" disabled={busy||lessonDraft.recurrenceKey.length<2||lessonDraft.title.trim().length<3||lessonDraft.observation.trim().length<5} onClick={()=>void addLesson()}>Adicionar lição</button>{(aar.lessons??lessonRecent.filter(l=>l.exerciseId===ex.id)).map(l=><p key={l.id}><small>{l.category} · {l.recurrenceKey} · {l.title}</small></p>)}</div>}{aar.status==="DRAFT"&&<div className="incidentForm compactForm"><h3>Nova ação corretiva</h3><label>Título<input value={actionDraft.title} onChange={e=>setActionDraft(v=>({...v,title:e.target.value}))}/></label><label>Descrição<textarea value={actionDraft.description} onChange={e=>setActionDraft(v=>({...v,description:e.target.value}))}/></label><label>Prioridade<select value={actionDraft.priority} onChange={e=>setActionDraft(v=>({...v,priority:e.target.value}))}><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label><label>Responsável<select value={actionDraft.ownerUserId} onChange={e=>setActionDraft(v=>({...v,ownerUserId:e.target.value}))}><option value="">Selecionar</option>{(runbook?.operators??[]).map(person=><option key={person.id} value={person.id}>{person.displayName+" · "+person.matricula}</option>)}</select></label><label>Prazo<input type="date" value={actionDraft.dueAt} onChange={e=>setActionDraft(v=>({...v,dueAt:e.target.value}))}/></label><label>Risco relacionado<select value={actionDraft.riskId} onChange={e=>setActionDraft(v=>({...v,riskId:e.target.value}))}><option value="">Sem vínculo</option>{riskReferences.map(risk=><option key={risk.id} value={risk.id}>{risk.code+" · "+risk.title+" · score "+(risk.probability*risk.impact)}</option>)}</select></label><label>Ação de recuperação relacionada<select value={actionDraft.recoveryActionId} onChange={e=>setActionDraft(v=>({...v,recoveryActionId:e.target.value}))}><option value="">Sem vínculo</option>{recoveryReferences.map(item=><option key={item.id} value={item.id}>{item.title+" · "+item.status}</option>)}</select></label><button type="button" className="secondaryLink" disabled={busy||actionDraft.title.trim().length<3} onClick={()=>void addAarAction()}>Adicionar ação</button></div>}</>}</section>})()}

  <section style={{marginTop:18}}><h2>Histórico de versões</h2><div className="dataGrid">{(runbook?.revisions??[]).map(item=><article className="card" key={item.id}><h2>{"v"+item.version+" · "+item.status}</h2><p>{item.title}</p><p>Atualizada em {new Date(item.updatedAt).toLocaleString("pt-BR")}</p></article>)}</div></section>
 </main>
}
