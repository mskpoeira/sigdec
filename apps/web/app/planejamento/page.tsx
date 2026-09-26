"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {formatDateTimeBR,ubatubaLocalDateTimeToIso} from "../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Plan={id:string;code:string;version:number;title:string;cobradeCode:string|null;status:string;currentLevel:string;scope:string|null;createdAt:string;approvedAt:string|null;createdByMatricula:string;createdByName:string;approvedByMatricula:string|null;approvedByName:string|null;activationCount:number};
type Case={id:string;cobradeCode:string;situationType:string;status:string;summary:string;decreeNumber:string|null;decreeDate:string|null;externalProtocol:string|null;deadlineAt:string|null;createdAt:string;incidentProtocol:string|null;createdByMatricula:string;createdByName:string;fvdCount:number;pendingFvd:number};
type Fvd={id:string;code:string;requirementType:string;title:string;status:string;dueAt:string|null;responseNotes:string|null;createdAt:string;createdByMatricula:string};
type Summary={planCount:number;activePlans:number;openAnomalyCases:number;pendingFvd:number;activations24h:number};
type Cobrade={code:string;name:string;groupName:string|null;subgroupName:string|null};
const levels=["NORMAL","OBSERVATION","ATTENTION","ALERT","EMERGENCY"];
const levelName:Record<string,string>={NORMAL:"Normal",OBSERVATION:"Observação",ATTENTION:"Atenção",ALERT:"Alerta",EMERGENCY:"Emergência"};
const statusName:Record<string,string>={DRAFT:"Rascunho",APPROVED:"Aprovado",ACTIVE:"Ativo",ARCHIVED:"Arquivado",DOCUMENTING:"Em documentação",SUBMITTED:"Enviado",UNDER_REVIEW:"Em análise",RECOGNIZED:"Reconhecido",REJECTED:"Rejeitado",CLOSED:"Encerrado"};
const rows=(v:string)=>v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);

export default function PlanejamentoPage(){
 const[summary,setSummary]=useState<Summary|null>(null),[plans,setPlans]=useState<Plan[]>([]),[cases,setCases]=useState<Case[]>([]),[fvd,setFvd]=useState<Fvd[]>([]),[cobrade,setCobrade]=useState<Cobrade[]>([]);
 const[selectedCase,setSelectedCase]=useState(""),[activationPlan,setActivationPlan]=useState(""),[level,setLevel]=useState("OBSERVATION"),[reason,setReason]=useState("");
 const[message,setMessage]=useState(""),[busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");return body;
 },[]);

 const load=useCallback(async()=>{
  try{
   const data=await Promise.all([request("/api/v1/planning/summary"),request("/api/v1/plancon"),request("/api/v1/anomaly-cases"),request("/api/v1/planning/cobrade")]);
   setSummary(data[0]);setPlans(data[1].items??[]);setCases(data[2].items??[]);setCobrade(data[3].items??[]);
   const candidate=(data[1].items??[]).find((x:Plan)=>x.status==="APPROVED"||x.status==="ACTIVE");
   if(!activationPlan&&candidate)setActivationPlan(candidate.id);setMessage("");
  }catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar.");}
 },[request,activationPlan]);
 useEffect(()=>{void load()},[load]);

 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load()}catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}finally{setBusy(false)}}

 async function createPlan(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form);await perform(async()=>{
  await request("/api/v1/plancon",{method:"POST",body:JSON.stringify({code:String(d.get("code")??""),title:String(d.get("title")??""),cobradeCode:String(d.get("cobradeCode")??""),scope:String(d.get("scope")??""),objective:String(d.get("objective")??""),triggerCriteria:rows(String(d.get("triggers")??"")),callPlan:rows(String(d.get("callPlan")??"")),resources:rows(String(d.get("resources")??"")),sheltersRoutes:rows(String(d.get("shelters")??"")),procedures:rows(String(d.get("procedures")??"")),notes:String(d.get("notes")??"")})});form.reset();setMessage("PLANCON criado como rascunho.");
 })}

 async function planStatus(p:Plan,status:string){await perform(async()=>{await request("/api/v1/plancon/"+p.id+"/status",{method:"PATCH",body:JSON.stringify({status})});setMessage("Situação do PLANCON atualizada.");})}
 async function revision(p:Plan){await perform(async()=>{await request("/api/v1/plancon/"+p.id+"/revision",{method:"POST",body:"{}"});setMessage("Nova revisão criada.");})}
 async function activate(e:FormEvent<HTMLFormElement>){e.preventDefault();await perform(async()=>{await request("/api/v1/plancon/"+activationPlan+"/activation",{method:"POST",body:JSON.stringify({level,reason})});setReason("");setMessage("Nível operacional registrado com horário e matrícula.");})}

 async function createCase(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form),deadline=String(d.get("deadlineAt")??"");await perform(async()=>{
  await request("/api/v1/anomaly-cases",{method:"POST",body:JSON.stringify({incidentProtocol:String(d.get("incidentProtocol")??""),cobradeCode:String(d.get("cobradeCode")??""),situationType:String(d.get("situationType")??"SE"),summary:String(d.get("summary")??""),decreeNumber:String(d.get("decreeNumber")??""),decreeDate:String(d.get("decreeDate")??""),externalProtocol:String(d.get("externalProtocol")??""),deadlineAt:deadline?ubatubaLocalDateTimeToIso(deadline):undefined,notes:String(d.get("notes")??"")})});form.reset();setMessage("Processo SE/ECP criado.");
 })}

 async function caseStatus(item:Case,status:string){await perform(async()=>{await request("/api/v1/anomaly-cases/"+item.id,{method:"PATCH",body:JSON.stringify({status})});setMessage("Etapa atualizada.");})}
 async function loadFvd(id:string){setSelectedCase(id);try{const b=await request("/api/v1/anomaly-cases/"+id+"/fvd");setFvd(b.items??[])}catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar FVD.")}}
 async function addFvd(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form),due=String(d.get("dueAt")??"");await perform(async()=>{await request("/api/v1/anomaly-cases/"+selectedCase+"/fvd",{method:"POST",body:JSON.stringify({code:String(d.get("code")??""),requirementType:String(d.get("requirementType")??"OTHER"),title:String(d.get("title")??""),dueAt:due?ubatubaLocalDateTimeToIso(due):undefined,responseNotes:String(d.get("responseNotes")??"")})});form.reset();await loadFvd(selectedCase);setMessage("Pendência registrada.");})}
 async function fvdStatus(item:Fvd,status:string){await perform(async()=>{await request("/api/v1/anomaly-cases/"+selectedCase+"/fvd/"+item.id,{method:"PATCH",body:JSON.stringify({status})});await loadFvd(selectedCase);})}
 async function draft(item:Case,type:string){await perform(async()=>{await request("/api/v1/anomaly-cases/"+item.id+"/s2id/"+type,{method:"POST",body:"{}"});setMessage("Rascunho "+type+" criado no SIGDEC.");})}

 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">SIGDEC · PLANEJAMENTO E CONTINGÊNCIA · {SIGDEC_VERSION_LABEL}</span><h1>PLANCON e Situação de Anormalidade</h1><p>Preparação municipal, ativação operacional, SE/ECP, FVD e rascunhos FIDE/DMATE.</p></div><div className="headerActions"><Link className="secondaryLink" href="/gestao">Centro de Gestão</Link><Link className="secondaryLink" href="/painel">Painel</Link></div></header>
  {message&&<section className="infoCard">{message}</section>}
  <datalist id="cobradeCodes">{cobrade.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</datalist>
  <section className="dataGrid">
   <article className="card"><h2>PLANCON</h2><p className="adminNumber">{summary?.planCount??"—"}</p><p>{summary?.activePlans??0} ativo(s)</p></article>
   <article className="card"><h2>Ativações · 24h</h2><p className="adminNumber">{summary?.activations24h??"—"}</p></article>
   <article className="card"><h2>SE/ECP em andamento</h2><p className="adminNumber">{summary?.openAnomalyCases??"—"}</p></article>
   <article className={(summary?.pendingFvd??0)>0?"warningCard":"card"}><h2>Pendências FVD</h2><p className="adminNumber">{summary?.pendingFvd??"—"}</p></article>
  </section>

  <section style={{marginTop:20}}><h2>Novo PLANCON Municipal</h2><form className="incidentForm compactForm" onSubmit={createPlan}>
   <div className="formGrid"><label>Código<input name="code" required placeholder="PLANCON-CHUVAS"/></label><label>Título<input name="title" required/></label><label>COBRADE<input name="cobradeCode" list="cobradeCodes"/></label><label>Escopo<input name="scope"/></label></div>
   <label>Objetivo<textarea name="objective" rows={2}/></label><div className="formGrid"><label>Gatilhos · um por linha<textarea name="triggers" rows={4}/></label><label>Plano de chamada · um por linha<textarea name="callPlan" rows={4}/></label><label>Recursos · um por linha<textarea name="resources" rows={4}/></label><label>Abrigos e rotas · um por linha<textarea name="shelters" rows={4}/></label></div>
   <label>Procedimentos operacionais · um por linha<textarea name="procedures" rows={5}/></label><label>Observações<textarea name="notes" rows={2}/></label><button className="primaryButton" disabled={busy}>Criar PLANCON</button>
  </form></section>

  <section style={{marginTop:20}}><h2>Planos cadastrados</h2><div className="dataGrid">{plans.map(p=><article className={p.currentLevel==="EMERGENCY"?"warningCard":"card"} key={p.id}>
   <h3>{p.code} · v{p.version}</h3><p><strong>{p.title}</strong></p><p>{statusName[p.status]??p.status} · nível <strong>{levelName[p.currentLevel]??p.currentLevel}</strong>{p.cobradeCode?" · COBRADE "+p.cobradeCode:""}</p><p>{p.scope??"Sem escopo informado"}</p>
   <p><small>Registrado em {formatDateTimeBR(p.createdAt)} · matrícula {p.createdByMatricula} · {p.createdByName}</small></p>{p.approvedAt&&<p><small>Aprovado em {formatDateTimeBR(p.approvedAt)} · matrícula {p.approvedByMatricula??"—"}</small></p>}<p>{p.activationCount} ativação(ões)</p>
   <div className="headerActions">{p.status==="DRAFT"&&<button type="button" className="primaryButton" onClick={()=>void planStatus(p,"APPROVED")}>Aprovar</button>}{p.status==="APPROVED"&&<button type="button" className="primaryButton" onClick={()=>void planStatus(p,"ACTIVE")}>Tornar ativo</button>}{p.status!=="ARCHIVED"&&<button type="button" className="secondaryLink" onClick={()=>void revision(p)}>Nova revisão</button>}{p.status!=="ARCHIVED"&&<button type="button" className="secondaryLink" onClick={()=>void planStatus(p,"ARCHIVED")}>Arquivar</button>}</div>
  </article>)}</div></section>

  <section style={{marginTop:20}}><h2>Alterar nível operacional</h2><form className="incidentForm compactForm" onSubmit={activate}><div className="formGrid"><label>PLANCON<select value={activationPlan} onChange={e=>setActivationPlan(e.target.value)}>{plans.filter(p=>p.status==="APPROVED"||p.status==="ACTIVE").map(p=><option key={p.id} value={p.id}>{p.code} · v{p.version}</option>)}</select></label><label>Novo nível<select value={level} onChange={e=>setLevel(e.target.value)}>{levels.map(x=><option key={x} value={x}>{levelName[x]}</option>)}</select></label></div><label>Motivo<textarea required rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primaryButton" disabled={busy||!activationPlan||reason.trim().length<3}>Registrar nível</button></form></section>

  <section style={{marginTop:26}}><h2>Situação de Anormalidade · SE/ECP</h2><p>Controle municipal. O registro interno não representa reconhecimento automático por órgão estadual ou federal.</p><form className="incidentForm compactForm" onSubmit={createCase}>
   <div className="formGrid"><label>Protocolo da ocorrência<input name="incidentProtocol" placeholder="Opcional"/></label><label>COBRADE<input name="cobradeCode" list="cobradeCodes" required/></label><label>Tipo<select name="situationType"><option value="SE">Situação de Emergência — SE</option><option value="ECP">Estado de Calamidade Pública — ECP</option></select></label><label>Nº decreto<input name="decreeNumber"/></label><label>Data decreto<input name="decreeDate" type="date"/></label><label>Protocolo externo<input name="externalProtocol"/></label><label>Prazo acompanhamento<input name="deadlineAt" type="datetime-local"/></label></div>
   <label>Resumo<textarea name="summary" required rows={4}/></label><label>Observações<textarea name="notes" rows={2}/></label><button className="primaryButton" disabled={busy}>Criar processo SE/ECP</button>
  </form></section>

  <section style={{marginTop:20}}><h2>Processos SE/ECP</h2><div className="dataGrid">{cases.map(item=><article className={item.pendingFvd>0?"warningCard":"card"} key={item.id}>
   <h3>{item.situationType} · COBRADE {item.cobradeCode}</h3><p><strong>{statusName[item.status]??item.status}</strong>{item.incidentProtocol?" · "+item.incidentProtocol:""}</p><p>{item.summary}</p>{item.decreeNumber&&<p>Decreto {item.decreeNumber}{item.decreeDate?" · "+item.decreeDate:""}</p>}{item.externalProtocol&&<p>Protocolo externo: {item.externalProtocol}</p>}{item.deadlineAt&&<p>Prazo: {formatDateTimeBR(item.deadlineAt)}</p>}<p>{item.pendingFvd} pendência(s) ativa(s) de {item.fvdCount}</p><p><small>Registrado em {formatDateTimeBR(item.createdAt)} · matrícula {item.createdByMatricula} · {item.createdByName}</small></p>
   <div className="headerActions"><select value={item.status} onChange={e=>void caseStatus(item,e.target.value)}>{["DRAFT","DOCUMENTING","SUBMITTED","UNDER_REVIEW","RECOGNIZED","REJECTED","CLOSED"].map(x=><option key={x} value={x}>{statusName[x]??x}</option>)}</select><button type="button" className="secondaryLink" onClick={()=>void loadFvd(item.id)}>FVD / Pendências</button><button type="button" className="secondaryLink" onClick={()=>void draft(item,"FIDE")}>Criar FIDE</button><button type="button" className="secondaryLink" onClick={()=>void draft(item,"DMATE")}>Criar DMATE</button></div>
  </article>)}</div></section>

  {selectedCase&&<section style={{marginTop:26}}><h2>FVD e pendências documentais</h2><form className="incidentForm compactForm" onSubmit={addFvd}><div className="formGrid"><label>Código<input name="code" required placeholder="FVD-01"/></label><label>Tipo<select name="requirementType"><option value="FIDE">FIDE</option><option value="DMATE">DMATE</option><option value="PHOTO_REPORT">Relatório fotográfico</option><option value="DECREE">Decreto</option><option value="TECHNICAL_REPORT">Relatório técnico</option><option value="OTHER">Outro</option></select></label><label>Prazo<input name="dueAt" type="datetime-local"/></label></div><label>Exigência<input name="title" required/></label><label>Resposta / observações<textarea name="responseNotes" rows={2}/></label><button className="primaryButton" disabled={busy}>Registrar pendência</button></form>
   <div className="adminTableWrap"><table><thead><tr><th>Código</th><th>Tipo</th><th>Pendência</th><th>Prazo</th><th>Status</th><th>Registro</th></tr></thead><tbody>{fvd.map(x=><tr key={x.id}><td>{x.code}</td><td>{x.requirementType}</td><td>{x.title}{x.responseNotes&&<><br/><small>{x.responseNotes}</small></>}</td><td>{x.dueAt?formatDateTimeBR(x.dueAt):"—"}</td><td><select value={x.status} onChange={e=>void fvdStatus(x,e.target.value)}><option value="PENDING">Pendente</option><option value="RESPONDED">Respondida</option><option value="ACCEPTED">Aceita</option><option value="REJECTED">Rejeitada</option></select></td><td>{formatDateTimeBR(x.createdAt)}<br/><small>matrícula {x.createdByMatricula}</small></td></tr>)}</tbody></table>{fvd.length===0&&<p>Nenhuma pendência cadastrada.</p>}</div>
  </section>}
 </main>;
}
