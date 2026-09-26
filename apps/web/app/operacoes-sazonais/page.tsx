"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {formatDateTimeBR,ubatubaLocalDateTimeToIso} from "../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Plan={id:string;code:string;version:number;title:string;status:string};
type Operation={id:string;code:string;title:string;operationType:string;startsAt:string;endsAt:string;status:string;objective:string|null;coordinator:string|null;notes:string|null;createdAt:string;planCode:string|null;planVersion:number|null;checklistCount:number};
type Checklist={id:string;sequenceNo:number;title:string;frequency:string;required:boolean;latestStatus:string|null;latestNotes:string|null;latestActorMatricula:string|null;latestAt:string|null};

const typeLabels:Record<string,string>={CHUVAS:"Chuvas de verão",ESTIAGEM:"Estiagem",FRIO:"Baixas temperaturas",RESSACA:"Ressaca/mar agitado",INCENDIOS:"Incêndios em vegetação",EVENTOS_EXTREMOS:"Eventos extremos",MASS_EVENT:"Grande evento",OTHER:"Outra"};
const statusLabels:Record<string,string>={PLANNED:"Planejada",ACTIVE:"Ativa",SUSPENDED:"Suspensa",CLOSED:"Encerrada"};
const freqLabels:Record<string,string>={ONCE:"Uma vez",SHIFT:"Por turno",DAILY:"Diário",WEEKLY:"Semanal",EVENT:"Por evento"};
const checkLabels:Record<string,string>={DONE:"Concluído",NOT_APPLICABLE:"Não aplicável",REOPENED:"Reaberto"};

export default function OperacoesSazonaisPage(){
 const[items,setItems]=useState<Operation[]>([]);
 const[plans,setPlans]=useState<Plan[]>([]);
 const[selected,setSelected]=useState<Operation|null>(null);
 const[checklist,setChecklist]=useState<Checklist[]>([]);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");
  return body;
 },[]);

 const load=useCallback(async()=>{
  const [ops,p]=await Promise.all([request("/api/v1/seasonal-operations"),request("/api/v1/plancon")]);
  setItems(ops.items??[]);setPlans(p.items??[]);
 },[request]);
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar."))},[load]);

 async function open(item:Operation){
  setSelected(item);const b=await request("/api/v1/seasonal-operations/"+item.id+"/checklist");setChecklist(b.items??[]);
 }
 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load();if(selected)await open(selected)}catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}finally{setBusy(false)}}

 async function createOperation(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/seasonal-operations",{method:"POST",body:JSON.stringify({
    code:String(d.get("code")??""),title:String(d.get("title")??""),operationType:String(d.get("operationType")??"CHUVAS"),
    planId:String(d.get("planId")??"")||undefined,startsAt:ubatubaLocalDateTimeToIso(String(d.get("startsAt")??"")),
    endsAt:ubatubaLocalDateTimeToIso(String(d.get("endsAt")??"")),objective:String(d.get("objective")??""),
    coordinator:String(d.get("coordinator")??""),notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Operação sazonal criada.");
  });
 }

 async function changeStatus(item:Operation,status:string){
  await perform(async()=>{await request("/api/v1/seasonal-operations/"+item.id+"/status",{method:"PATCH",body:JSON.stringify({status})});setMessage("Situação da operação atualizada.");});
 }

 async function addItem(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected)return;const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/seasonal-operations/"+selected.id+"/checklist",{method:"POST",body:JSON.stringify({
    title:String(d.get("title")??""),frequency:String(d.get("frequency")??"ONCE"),required:d.get("required")==="on"
   })});form.reset();setMessage("Item de prontidão incluído.");
  });
 }

 async function checklistEvent(item:Checklist,status:string){
  let notes="";if(status==="NOT_APPLICABLE")notes=window.prompt("Justificativa:","")?.trim()??"";
  await perform(async()=>{await request("/api/v1/seasonal-operations/"+selected!.id+"/checklist/"+item.id+"/events",{method:"POST",body:JSON.stringify({status,notes})});});
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · OPERAÇÕES SAZONAIS · {SIGDEC_VERSION_LABEL}</span><h1>Operações Sazonais e Prontidão</h1>
    <p>Chuvas, estiagem, frio, ressaca, incêndios, eventos extremos e operações especiais, vinculáveis ao PLANCON.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/resiliencia">Centro de Resiliência</Link><Link className="secondaryLink" href="/planejamento/operacao">Operação PLANCON</Link></div>
  </header>
  {message&&<section className="infoCard">{message}</section>}

  <section style={{marginTop:18}}>
   <h2>Nova operação sazonal</h2>
   <form className="incidentForm compactForm" onSubmit={createOperation}>
    <div className="formGrid">
     <label>Código<input name="code" required placeholder="CHUVAS-2026-2027"/></label>
     <label>Título<input name="title" required/></label>
     <label>Tipo<select name="operationType">{Object.keys(typeLabels).map(x=><option key={x} value={x}>{typeLabels[x]}</option>)}</select></label>
     <label>PLANCON<select name="planId"><option value="">Sem vínculo</option>{plans.map(x=><option key={x.id} value={x.id}>{x.code} · v{x.version}</option>)}</select></label>
     <label>Início<input name="startsAt" type="datetime-local" required/></label>
     <label>Fim<input name="endsAt" type="datetime-local" required/></label>
     <label>Coordenação<input name="coordinator"/></label>
    </div>
    <label>Objetivo<textarea name="objective" rows={3}/></label>
    <label>Observações<textarea name="notes" rows={2}/></label>
    <button className="primaryButton" disabled={busy}>Criar operação</button>
   </form>
  </section>

  <section style={{marginTop:24}}>
   <h2>Operações</h2>
   <div className="adminTableWrap"><table><thead><tr><th>Operação</th><th>Período</th><th>Status</th><th>PLANCON</th><th>Checklist</th><th>Ações</th></tr></thead>
    <tbody>{items.map(x=><tr key={x.id}><td><strong>{x.code}</strong><br/><small>{x.title} · {typeLabels[x.operationType]??x.operationType}</small></td><td>{formatDateTimeBR(x.startsAt)}<br/>até {formatDateTimeBR(x.endsAt)}</td><td>{statusLabels[x.status]??x.status}</td><td>{x.planCode?x.planCode+" · v"+x.planVersion:"—"}</td><td>{x.checklistCount}</td><td><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>void open(x)}>Abrir</button>{x.status==="PLANNED"&&<button type="button" className="primaryButton" onClick={()=>void changeStatus(x,"ACTIVE")}>Ativar</button>}{x.status==="ACTIVE"&&<button type="button" className="secondaryLink" onClick={()=>void changeStatus(x,"SUSPENDED")}>Suspender</button>}{x.status!=="CLOSED"&&<button type="button" className="secondaryLink" onClick={()=>void changeStatus(x,"CLOSED")}>Encerrar</button>}</div></td></tr>)}</tbody>
   </table>{items.length===0&&<p>Nenhuma operação cadastrada.</p>}</div>
  </section>

  {selected&&<section style={{marginTop:28}}>
   <div className="listHeader"><div><h2>{selected.code} · {selected.title}</h2><p>{selected.objective||"Sem objetivo detalhado."}</p></div><button type="button" className="secondaryLink" onClick={()=>setSelected(null)}>Fechar</button></div>
   <h3>Checklist operacional</h3>
   <div className="adminTableWrap"><table><thead><tr><th>#</th><th>Item</th><th>Frequência</th><th>Status</th><th>Último registro</th><th>Ações</th></tr></thead>
    <tbody>{checklist.map(x=><tr key={x.id}><td>{x.sequenceNo}</td><td>{x.title}{x.required?" · obrigatório":""}</td><td>{freqLabels[x.frequency]??x.frequency}</td><td>{checkLabels[x.latestStatus??""]??"Pendente"}</td><td>{x.latestAt?formatDateTimeBR(x.latestAt):"—"}{x.latestActorMatricula&&<><br/><small>matrícula {x.latestActorMatricula}</small></>}</td><td><div className="headerActions"><button type="button" className="primaryButton" onClick={()=>void checklistEvent(x,"DONE")}>Concluir</button><button type="button" className="secondaryLink" onClick={()=>void checklistEvent(x,"NOT_APPLICABLE")}>Não aplicável</button>{x.latestStatus&&<button type="button" className="secondaryLink" onClick={()=>void checklistEvent(x,"REOPENED")}>Reabrir</button>}</div></td></tr>)}</tbody>
   </table>{checklist.length===0&&<p>Nenhum item cadastrado.</p>}</div>

   <form className="incidentForm compactForm" onSubmit={addItem}><h3>Adicionar item de prontidão</h3><div className="formGrid"><label>Descrição<input name="title" required/></label><label>Frequência<select name="frequency">{Object.keys(freqLabels).map(x=><option key={x} value={x}>{freqLabels[x]}</option>)}</select></label><label><input name="required" type="checkbox" defaultChecked/> Obrigatório</label></div><button className="secondaryLink" disabled={busy}>Adicionar item</button></form>
  </section>}
 </main>;
}
