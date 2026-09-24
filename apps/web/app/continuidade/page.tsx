"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Operator={id:string;matricula:string;displayName:string;jobTitle?:string|null};
type RunbookStep={id?:string;phase:"DECLARATION"|"COMMUNICATION"|"PRESERVATION"|"RECOVERY"|"VALIDATION"|"RETURN";sortOrder:number;title:string;instructions:string;expectedMinutes:number;ownerUserId?:string|null;ownerName?:string|null;ownerMatricula?:string|null;required:boolean};
type RunbookPlan={id:string;version:number;title:string;status:"DRAFT"|"ACTIVE"|"RETIRED";activationCriteria:string;recoveryStrategy:string;communicationPlan:string;returnToNormal:string;updatedAt:string;activatedAt?:string|null;activatedByName?:string|null;steps:RunbookStep[]};
type RunbookData={active:RunbookPlan|null;draft:RunbookPlan|null;revisions:Array<{id:string;version:number;title:string;status:string;updatedAt:string}>;operators:Operator[]};
type ExerciseStep={stepId:string;phase:string;title:string;instructions:string;expectedMinutes:number;required:boolean;ownerName?:string|null;status:"PENDING"|"COMPLETED"|"SKIPPED"|"FAILED"};
type Exercise={id:string;planVersion:number;scenario:string;status:"IN_PROGRESS"|"COMPLETED"|"CANCELLED";result?:"PASS"|"PARTIAL"|"FAIL"|null;notes?:string|null;startedAt:string;summary:{total:number;completed:number;skipped:number;failed:number;pending:number;requiredPending:number;progressPct:number};steps:ExerciseStep[]};

const phaseLabels:Record<string,string>={DECLARATION:"Declaração",COMMUNICATION:"Comunicação",PRESERVATION:"Preservação",RECOVERY:"Recuperação",VALIDATION:"Validação",RETURN:"Retorno à normalidade"};
const resultLabels:Record<string,string>={PASS:"Aprovado",PARTIAL:"Parcial",FAIL:"Falhou"};

export default function ContinuidadePage(){
 const [runbook,setRunbook]=useState<RunbookData|null>(null);
 const [exercises,setExercises]=useState<Exercise[]>([]);
 const [scenario,setScenario]=useState("Exercício de mesa para validar o Plano de Continuidade SIDEC, responsáveis, preservação, recuperação, validação e retorno à normalidade.");
 const [finishNotes,setFinishNotes]=useState("");
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
   const [r,e]=await Promise.all([request("/api/v1/sidec/continuity/runbook"),request("/api/v1/sidec/continuity/exercises")]);
   if(r)setRunbook(r);
   if(e)setExercises(e.items??[]);
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
  await request("/api/v1/sidec/continuity/exercises/"+exerciseId+"/steps/"+stepId,{method:"PATCH",body:JSON.stringify({status})});
  setMessage("Etapa atualizada.");
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
   <div><span className="eyebrow">SIGDEC · CONTINUIDADE SIDEC · v1.26</span><h1>Plano de Continuidade e Runbook</h1><p>Versões controladas, responsáveis nominais e exercícios de mesa auditáveis. Esta tela não executa failover real automaticamente.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/gestao">Centro de Gestão</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>
  {error&&<p className="errorMessage">{error}</p>}{message&&<p className="formMessage">{message}</p>}

  <section className="dataGrid">
   <article className={active?"card":"warningCard"}><h2>Runbook ativo</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{active?"v"+active.version:"Nenhum"}</p><p>{active?.title??"Ative uma revisão antes de iniciar exercícios."}</p></article>
   <article className="card"><h2>Revisão em elaboração</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{draft?"v"+draft.version:"—"}</p><p>{draft?"Editável até a ativação.":"Nenhum rascunho aberto."}</p></article>
   <article className={activeExercise?"warningCard":"card"}><h2>Exercício em andamento</h2><p style={{fontSize:"1.6rem",fontWeight:900}}>{activeExercise?activeExercise.summary.progressPct+"%":"Nenhum"}</p><p>{activeExercise?activeExercise.summary.pending+" etapa(s) pendente(s).":"Operação normal."}</p></article>
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
    <div className="dataGrid">{activeExercise.steps.map(step=><article className={step.status==="FAILED"?"warningCard":"card"} key={step.stepId}><h2>{phaseLabels[step.phase]??step.phase}</h2><p><strong>{step.title}</strong></p><p>{step.instructions}</p><p>{"Responsável previsto: "+(step.ownerName??"—")+" · "+step.expectedMinutes+" min · "+step.status}</p><div className="headerActions"><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"COMPLETED")}>Concluir</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"SKIPPED")}>Pular</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"FAILED")}>Falha</button>{step.status!=="PENDING"&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void updateExerciseStep(activeExercise.id,step.stepId,"PENDING")}>Reabrir</button>}</div></article>)}</div>
    <label>Observações de encerramento<textarea value={finishNotes} onChange={e=>setFinishNotes(e.target.value)}/></label><div className="headerActions"><button type="button" className="primaryButton" disabled={busy||activeExercise.summary.requiredPending>0} onClick={()=>void finishExercise(activeExercise.id)}>Encerrar e calcular resultado</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void cancelExercise(activeExercise.id)}>Cancelar exercício</button></div>
   </div>}
   <div className="dataGrid" style={{marginTop:14}}>{exercises.filter(x=>x.status!=="IN_PROGRESS").slice(0,12).map(ex=><article className={ex.result==="FAIL"?"warningCard":"card"} key={ex.id}><h2>{"Runbook v"+ex.planVersion+" · "+ex.status}</h2><p><strong>{ex.result?resultLabels[ex.result]??ex.result:"Sem resultado"}</strong> · {new Date(ex.startedAt).toLocaleString("pt-BR")}</p><p>{ex.scenario}</p><p>Concluídas {ex.summary.completed}/{ex.summary.total} · puladas {ex.summary.skipped} · falhas {ex.summary.failed}</p>{ex.notes&&<p>{ex.notes}</p>}</article>)}</div>
  </section>

  <section style={{marginTop:18}}><h2>Histórico de versões</h2><div className="dataGrid">{(runbook?.revisions??[]).map(item=><article className="card" key={item.id}><h2>{"v"+item.version+" · "+item.status}</h2><p>{item.title}</p><p>Atualizada em {new Date(item.updatedAt).toLocaleString("pt-BR")}</p></article>)}</div></section>
 </main>
}
