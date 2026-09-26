"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {formatDateTimeBR,ubatubaLocalDateTimeToIso} from "../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Plan={id:string;code:string;version:number};
type Seasonal={id:string;code:string;title:string};
type Exercise={id:string;code:string;title:string;exerciseType:string;scenario:string;objectives:string[];scheduledAt:string;startedAt:string|null;endedAt:string|null;status:string;evaluator:string|null;notes:string|null;createdAt:string;planCode:string|null;planVersion:number|null;seasonalCode:string|null;evaluationCount:number;openActions:number};
type Evaluation={id:string;capability:string;objective:string;target:string|null;result:string;evidence:string|null;notes:string|null;createdAt:string};
type Action={id:string;title:string;correctiveAction:string;dueAt:string|null;status:string;notes:string|null;ownerName:string|null;ownerMatricula:string|null;verifiedAt:string|null;verifiedByName:string|null;verifiedByMatricula:string|null};

const typeLabels:Record<string,string>={TABLETOP:"Mesa/Tabletop",DRILL:"Exercício prático",FUNCTIONAL:"Funcional",FULL_SCALE:"Escala completa",SEMINAR:"Seminário",WORKSHOP:"Oficina"};
const statusLabels:Record<string,string>={PLANNED:"Planejado",RUNNING:"Em execução",COMPLETED:"Concluído",CANCELLED:"Cancelado"};
const resultLabels:Record<string,string>={MET:"Meta atingida",PARTIAL:"Parcial",NOT_MET:"Não atingida",OBSERVATION:"Observação"};
const actionLabels:Record<string,string>={OPEN:"Aberta",IN_PROGRESS:"Em andamento",DONE:"Concluída",VERIFIED:"Verificada",CANCELLED:"Cancelada"};

export default function SimuladosPage(){
 const[items,setItems]=useState<Exercise[]>([]);
 const[plans,setPlans]=useState<Plan[]>([]);
 const[seasonals,setSeasonals]=useState<Seasonal[]>([]);
 const[selected,setSelected]=useState<Exercise|null>(null);
 const[evaluations,setEvaluations]=useState<Evaluation[]>([]);
 const[actions,setActions]=useState<Action[]>([]);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");return body;
 },[]);

 const load=useCallback(async()=>{
  const [e,p,s]=await Promise.all([request("/api/v1/exercises"),request("/api/v1/plancon"),request("/api/v1/seasonal-operations")]);
  setItems(e.items??[]);setPlans(p.items??[]);setSeasonals(s.items??[]);
 },[request]);
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar."))},[load]);

 async function open(item:Exercise){
  setSelected(item);const b=await request("/api/v1/exercises/"+item.id+"/review");setEvaluations(b.evaluations??[]);setActions(b.actions??[]);
 }
 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load();if(selected){const updated=(await request("/api/v1/exercises")).items?.find((x:Exercise)=>x.id===selected.id)??selected;await open(updated)}}catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}finally{setBusy(false)}}

 async function createExercise(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  const objectives=String(d.get("objectives")??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  await perform(async()=>{
   await request("/api/v1/exercises",{method:"POST",body:JSON.stringify({
    code:String(d.get("code")??""),title:String(d.get("title")??""),exerciseType:String(d.get("exerciseType")??"TABLETOP"),
    planId:String(d.get("planId")??"")||undefined,seasonalOperationId:String(d.get("seasonalOperationId")??"")||undefined,
    scenario:String(d.get("scenario")??""),objectives,scheduledAt:ubatubaLocalDateTimeToIso(String(d.get("scheduledAt")??"")),
    evaluator:String(d.get("evaluator")??""),notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Simulado/exercício criado.");
  });
 }

 async function changeStatus(item:Exercise,status:string){
  await perform(async()=>{await request("/api/v1/exercises/"+item.id+"/status",{method:"PATCH",body:JSON.stringify({status})});setMessage("Situação do exercício atualizada.");});
 }

 async function addEvaluation(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected)return;const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/exercises/"+selected.id+"/evaluations",{method:"POST",body:JSON.stringify({
    capability:String(d.get("capability")??""),objective:String(d.get("objective")??""),target:String(d.get("target")??""),
    result:String(d.get("result")??"OBSERVATION"),evidence:String(d.get("evidence")??""),notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Avaliação adicionada ao AAR.");
  });
 }

 async function addAction(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected)return;const form=e.currentTarget,d=new FormData(form),due=String(d.get("dueAt")??"");
  await perform(async()=>{
   await request("/api/v1/exercises/"+selected.id+"/improvements",{method:"POST",body:JSON.stringify({
    title:String(d.get("title")??""),correctiveAction:String(d.get("correctiveAction")??""),
    dueAt:due?ubatubaLocalDateTimeToIso(due):undefined,notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Ação de melhoria incluída no plano.");
  });
 }

 async function actionStatus(item:Action,status:string){
  let notes="";if(status==="VERIFIED")notes=window.prompt("Evidência/observação da verificação:","")?.trim()??"";
  await perform(async()=>{await request("/api/v1/exercises/"+selected!.id+"/improvements/"+item.id,{method:"PATCH",body:JSON.stringify({status,notes})});});
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · SIMULADOS E MELHORIA CONTÍNUA · {SIGDEC_VERSION_LABEL}</span><h1>Exercícios, AAR e Plano de Melhoria</h1>
    <p>Planejamento, execução, avaliação de capacidades e acompanhamento das ações corretivas após simulados.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/resiliencia">Centro de Resiliência</Link><Link className="secondaryLink" href="/operacoes-sazonais">Operações sazonais</Link></div>
  </header>
  {message&&<section className="infoCard">{message}</section>}

  <section style={{marginTop:18}}>
   <h2>Novo exercício/simulado</h2>
   <form className="incidentForm compactForm" onSubmit={createExercise}>
    <div className="formGrid">
     <label>Código<input name="code" required placeholder="SIM-CHUVAS-2026-01"/></label>
     <label>Título<input name="title" required/></label>
     <label>Tipo<select name="exerciseType">{Object.keys(typeLabels).map(x=><option key={x} value={x}>{typeLabels[x]}</option>)}</select></label>
     <label>PLANCON<select name="planId"><option value="">Sem vínculo</option>{plans.map(x=><option key={x.id} value={x.id}>{x.code} · v{x.version}</option>)}</select></label>
     <label>Operação sazonal<select name="seasonalOperationId"><option value="">Sem vínculo</option>{seasonals.map(x=><option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select></label>
     <label>Data/hora<input name="scheduledAt" type="datetime-local" required/></label>
     <label>Avaliador/coordenador<input name="evaluator"/></label>
    </div>
    <label>Cenário<textarea name="scenario" rows={4} required placeholder="Descreva ameaça, condições, evolução esperada e contexto operacional."/></label>
    <label>Objetivos · um por linha<textarea name="objectives" rows={4}/></label>
    <label>Observações<textarea name="notes" rows={2}/></label>
    <button className="primaryButton" disabled={busy}>Criar exercício</button>
   </form>
  </section>

  <section style={{marginTop:24}}>
   <h2>Exercícios</h2>
   <div className="adminTableWrap"><table><thead><tr><th>Exercício</th><th>Tipo</th><th>Data</th><th>Status</th><th>Avaliações</th><th>Ações abertas</th><th>Ações</th></tr></thead>
    <tbody>{items.map(x=><tr key={x.id}><td><strong>{x.code}</strong><br/><small>{x.title}{x.planCode?" · "+x.planCode+" v"+x.planVersion:""}</small></td><td>{typeLabels[x.exerciseType]??x.exerciseType}</td><td>{formatDateTimeBR(x.scheduledAt)}</td><td>{statusLabels[x.status]??x.status}</td><td>{x.evaluationCount}</td><td>{x.openActions}</td><td><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>void open(x)}>AAR/IP</button>{x.status==="PLANNED"&&<button type="button" className="primaryButton" onClick={()=>void changeStatus(x,"RUNNING")}>Iniciar</button>}{x.status==="RUNNING"&&<button type="button" className="primaryButton" onClick={()=>void changeStatus(x,"COMPLETED")}>Concluir</button>}</div></td></tr>)}</tbody>
   </table>{items.length===0&&<p>Nenhum exercício cadastrado.</p>}</div>
  </section>

  {selected&&<section style={{marginTop:28}}>
   <div className="listHeader"><div><h2>AAR/IP · {selected.code}</h2><p>{selected.scenario}</p></div><button type="button" className="secondaryLink" onClick={()=>setSelected(null)}>Fechar</button></div>
   <div className="infoCard"><strong>Objetivos</strong>{selected.objectives?.length?selected.objectives.map((x,i)=><p key={i}>{i+1}. {x}</p>):<p>Nenhum objetivo estruturado.</p>}</div>

   <h3>Avaliação de capacidades</h3>
   <div className="adminTableWrap"><table><thead><tr><th>Capacidade</th><th>Objetivo</th><th>Meta</th><th>Resultado</th><th>Evidência</th></tr></thead><tbody>{evaluations.map(x=><tr key={x.id}><td>{x.capability}</td><td>{x.objective}</td><td>{x.target??"—"}</td><td>{resultLabels[x.result]??x.result}</td><td>{x.evidence??"—"}</td></tr>)}</tbody></table></div>
   <form className="incidentForm compactForm" onSubmit={addEvaluation}>
    <div className="formGrid"><label>Capacidade<input name="capability" required placeholder="Comunicação, logística, abrigo, comando..."/></label><label>Objetivo avaliado<input name="objective" required/></label><label>Meta/critério<input name="target"/></label><label>Resultado<select name="result">{Object.keys(resultLabels).map(x=><option key={x} value={x}>{resultLabels[x]}</option>)}</select></label></div>
    <label>Evidência<textarea name="evidence" rows={2}/></label><label>Observações<input name="notes"/></label><button className="secondaryLink" disabled={busy}>Adicionar avaliação</button>
   </form>

   <h3>Plano de melhoria</h3>
   <div className="adminTableWrap"><table><thead><tr><th>Ação</th><th>Correção</th><th>Prazo</th><th>Status</th><th>Responsável</th><th>Ações</th></tr></thead><tbody>{actions.map(x=><tr key={x.id}><td>{x.title}</td><td>{x.correctiveAction}</td><td>{x.dueAt?formatDateTimeBR(x.dueAt):"—"}</td><td>{actionLabels[x.status]??x.status}</td><td>{x.ownerMatricula?x.ownerMatricula+" · "+(x.ownerName??""):"—"}</td><td><div className="headerActions">{x.status==="OPEN"&&<button type="button" className="secondaryLink" onClick={()=>void actionStatus(x,"IN_PROGRESS")}>Iniciar</button>}{x.status==="IN_PROGRESS"&&<button type="button" className="primaryButton" onClick={()=>void actionStatus(x,"DONE")}>Concluir</button>}{x.status==="DONE"&&<button type="button" className="primaryButton" onClick={()=>void actionStatus(x,"VERIFIED")}>Verificar</button>}</div></td></tr>)}</tbody></table></div>
   <form className="incidentForm compactForm" onSubmit={addAction}>
    <div className="formGrid"><label>Título<input name="title" required/></label><label>Prazo<input name="dueAt" type="datetime-local"/></label></div>
    <label>Ação corretiva<textarea name="correctiveAction" rows={3} required/></label><label>Observações<input name="notes"/></label><button className="secondaryLink" disabled={busy}>Adicionar ação de melhoria</button>
   </form>
  </section>}
 </main>;
}
