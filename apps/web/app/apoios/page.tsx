"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {formatDateTimeBR,ubatubaLocalDateTimeToIso} from "../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Support={
 id:string;scope:string;serviceType:string;cobradeCode:string|null;title:string;summary:string;status:string;
 externalSystem:string|null;externalProtocol:string|null;referenceUrl:string|null;requestedAmount:number|null;approvedAmount:number|null;
 deadlineAt:string|null;submittedAt:string|null;approvedAt:string|null;createdAt:string;updatedAt:string;incidentProtocol:string|null;
 createdByMatricula:string;createdByName:string;responsibleMatricula:string|null;responsibleName:string|null;
 requirementCount:number;pendingRequirements:number;
};
type Req={id:string;code:string;title:string;required:boolean;status:string;dueAt:string|null;notes:string|null;createdAt:string;updatedAt:string};
type Event={id:string;eventType:string;fromStatus:string|null;toStatus:string|null;notes:string|null;externalProtocol:string|null;amount:number|null;actorMatricula:string;actorName:string;occurredAt:string};
type Detail={item:Support;requirements:Req[];events:Event[]};

const serviceLabels:Record<string,string>={
 STATE_HUMANITARIAN:"Ajuda humanitária estadual",
 STATE_EMERGENCY_INSPECTION:"Vistoria emergencial estadual",
 STATE_KIT_CHUVAS:"Kit Chuvas",
 STATE_KIT_ESTIAGEM:"Kit Estiagem",
 STATE_KIT_FRIO:"Kit Frio",
 STATE_EMERGENCY_SUPPORT:"Apoio emergencial estadual",
 STATE_WORKS:"Obras/convênio estadual",
 STATE_EQUIPMENT_CONVENTION:"Aparelhamento/convênio estadual",
 FEDERAL_RECOGNITION:"Reconhecimento federal SE/ECP",
 FEDERAL_ASSISTANCE:"Recursos federais · assistência",
 FEDERAL_RESTORATION:"Recursos federais · restabelecimento",
 FEDERAL_RECONSTRUCTION:"Recursos federais · reconstrução",
 FEDERAL_HOUSING:"Recursos federais · habitação",
 FEDERAL_WATER_SUPPLY:"Operação de abastecimento de água",
 MUTUAL_AID:"Ajuda mútua",
 OTHER:"Outro apoio"
};
const statusLabels:Record<string,string>={
 DRAFT:"Rascunho",DOCUMENTING:"Em documentação",READY_TO_SUBMIT:"Pronto para protocolar",SUBMITTED:"Protocolado/enviado",
 UNDER_REVIEW:"Em análise",REQUIREMENTS:"Com exigências",APPROVED:"Aprovado",PARTIAL_APPROVED:"Aprovado parcialmente",
 REJECTED:"Rejeitado",EXECUTION:"Em execução",CLOSED:"Encerrado",CANCELLED:"Cancelado"
};
const scopes=[["STATE","Estadual"],["FEDERAL","Federal"],["MUTUAL_AID","Ajuda mútua"],["OTHER","Outro"]] as const;
const services=Object.keys(serviceLabels);
const statuses=Object.keys(statusLabels);

export default function ApoiosPage(){
 const[items,setItems]=useState<Support[]>([]);
 const[selected,setSelected]=useState<Detail|null>(null);
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
  const body=await request("/api/v1/external-support-requests");setItems(body.items??[]);
 },[request]);

 const open=useCallback(async(id:string)=>{
  const body=await request("/api/v1/external-support-requests/"+id);setSelected(body);
 },[request]);

 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar."))},[load]);

 async function perform(fn:()=>Promise<void>){
  setBusy(true);setMessage("");
  try{await fn();await load();if(selected)await open(selected.item.id)}
  catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}
  finally{setBusy(false)}
 }

 async function createRequest(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),deadline=String(d.get("deadlineAt")??""),amount=String(d.get("requestedAmount")??"").trim();
  await perform(async()=>{
   const body=await request("/api/v1/external-support-requests",{method:"POST",body:JSON.stringify({
    scope:String(d.get("scope")??"STATE"),serviceType:String(d.get("serviceType")??"STATE_HUMANITARIAN"),
    incidentProtocol:String(d.get("incidentProtocol")??""),cobradeCode:String(d.get("cobradeCode")??""),
    title:String(d.get("title")??""),summary:String(d.get("summary")??""),externalSystem:String(d.get("externalSystem")??""),
    referenceUrl:String(d.get("referenceUrl")??""),requestedAmount:amount?Number(amount):undefined,
    deadlineAt:deadline?ubatubaLocalDateTimeToIso(deadline):undefined
   })});
   form.reset();setMessage("Solicitação criada com checklist documental automático.");await open(body.id);
  });
 }

 async function updateStatus(){
  if(!selected)return;
  const next=window.prompt("Informe o novo status: "+statuses.join(", "),selected.item.status)?.trim().toUpperCase();
  if(!next||!statuses.includes(next))return;
  let protocol:string|undefined,approvedAmount:number|undefined;
  if(next==="SUBMITTED")protocol=window.prompt("Protocolo externo/estadual/federal (quando disponível):",selected.item.externalProtocol??"")?.trim()||undefined;
  if(next==="APPROVED"||next==="PARTIAL_APPROVED"){
   const raw=window.prompt("Valor aprovado, se aplicável:",selected.item.approvedAmount?.toString()??"")?.trim();
   if(raw)approvedAmount=Number(raw.replace(",","."));
  }
  const notes=window.prompt("Observação sobre a mudança de status:","")?.trim()??"";
  await perform(async()=>{
   await request("/api/v1/external-support-requests/"+selected.item.id,{method:"PATCH",body:JSON.stringify({status:next,externalProtocol:protocol,approvedAmount,notes})});
   setMessage("Situação atualizada com registro de horário e matrícula.");
  });
 }

 async function reqStatus(item:Req,status:string){
  let notes="";
  if(status==="REJECTED"||status==="NOT_APPLICABLE")notes=window.prompt("Justificativa/observação:","")?.trim()??"";
  await perform(async()=>{
   await request("/api/v1/external-support-requests/"+selected!.item.id+"/requirements/"+item.id,{method:"PATCH",body:JSON.stringify({status,notes})});
  });
 }

 async function addRequirement(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected)return;
  const form=e.currentTarget,d=new FormData(form),due=String(d.get("dueAt")??"");
  await perform(async()=>{
   await request("/api/v1/external-support-requests/"+selected.item.id+"/requirements",{method:"POST",body:JSON.stringify({
    code:String(d.get("code")??""),title:String(d.get("title")??""),required:d.get("required")==="on",
    dueAt:due?ubatubaLocalDateTimeToIso(due):undefined,notes:String(d.get("notes")??"")
   })});form.reset();
  });
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · APOIOS E RECURSOS · {SIGDEC_VERSION_LABEL}</span><h1>Solicitações Estaduais, Federais e Ajuda Mútua</h1>
    <p>Controle documental, protocolo, exigências, valores e execução sem simular transmissão automática a sistemas externos.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/resiliencia">Centro de Resiliência</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>
  {message&&<section className="infoCard">{message}</section>}

  <section style={{marginTop:18}}>
   <h2>Nova solicitação</h2>
   <form className="incidentForm compactForm" onSubmit={createRequest}>
    <div className="formGrid">
     <label>Âmbito<select name="scope">{scopes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label>Serviço<select name="serviceType">{services.map(x=><option key={x} value={x}>{serviceLabels[x]}</option>)}</select></label>
     <label>Protocolo da ocorrência<input name="incidentProtocol" placeholder="Opcional"/></label>
     <label>COBRADE<input name="cobradeCode"/></label>
     <label>Sistema externo<input name="externalSystem" placeholder="SIDEC, S2ID, Portal de Convênios..."/></label>
     <label>Prazo<input name="deadlineAt" type="datetime-local"/></label>
     <label>Valor solicitado<input name="requestedAmount" type="number" min="0" step="0.01"/></label>
     <label>URL de referência<input name="referenceUrl" type="url" placeholder="https://..."/></label>
    </div>
    <label>Título<input name="title" required/></label>
    <label>Justificativa / resumo<textarea name="summary" rows={4} required/></label>
    <button className="primaryButton" disabled={busy}>Criar solicitação e checklist</button>
   </form>
  </section>

  <section style={{marginTop:24}}>
   <h2>Solicitações</h2>
   <div className="adminTableWrap"><table><thead><tr><th>Serviço</th><th>Status</th><th>Protocolo</th><th>Pendências</th><th>Prazo</th><th>Responsável</th><th></th></tr></thead>
    <tbody>{items.map(x=><tr key={x.id}><td><strong>{serviceLabels[x.serviceType]??x.serviceType}</strong><br/><small>{x.title}{x.incidentProtocol?" · "+x.incidentProtocol:""}</small></td><td>{statusLabels[x.status]??x.status}</td><td>{x.externalProtocol??"—"}</td><td>{x.pendingRequirements}/{x.requirementCount}</td><td>{x.deadlineAt?formatDateTimeBR(x.deadlineAt):"—"}</td><td>{x.responsibleMatricula??x.createdByMatricula}<br/><small>{x.responsibleName??x.createdByName}</small></td><td><button className="secondaryLink" type="button" onClick={()=>void open(x.id)}>Abrir</button></td></tr>)}</tbody>
   </table>{items.length===0&&<p>Nenhuma solicitação registrada.</p>}</div>
  </section>

  {selected&&<section style={{marginTop:28}}>
   <div className="listHeader"><div><h2>{serviceLabels[selected.item.serviceType]??selected.item.serviceType}</h2><p>{selected.item.title}</p></div><div className="headerActions"><button type="button" className="primaryButton" disabled={busy} onClick={()=>void updateStatus()}>Alterar status</button><button type="button" className="secondaryLink" onClick={()=>setSelected(null)}>Fechar</button></div></div>
   <section className="dataGrid">
    <article className="card"><h3>Status</h3><p className="adminNumber">{statusLabels[selected.item.status]??selected.item.status}</p><p>{selected.item.externalProtocol?"Protocolo "+selected.item.externalProtocol:"Sem protocolo externo registrado"}</p></article>
    <article className={selected.item.pendingRequirements>0?"warningCard":"card"}><h3>Documentação</h3><p className="adminNumber">{selected.item.pendingRequirements}</p><p>pendência(s) ativa(s)</p></article>
    <article className="card"><h3>Valor</h3><p>{selected.item.requestedAmount!=null?"Solicitado: R$ "+selected.item.requestedAmount.toLocaleString("pt-BR",{minimumFractionDigits:2}):"Não informado"}</p><p>{selected.item.approvedAmount!=null?"Aprovado: R$ "+selected.item.approvedAmount.toLocaleString("pt-BR",{minimumFractionDigits:2}):""}</p></article>
   </section>
   <div className="infoCard"><strong>Resumo</strong><p>{selected.item.summary}</p><p><small>Criado em {formatDateTimeBR(selected.item.createdAt)} · matrícula {selected.item.createdByMatricula} · {selected.item.createdByName}</small></p></div>

   <h3>Checklist documental</h3>
   <div className="adminTableWrap"><table><thead><tr><th>Código</th><th>Documento/Requisito</th><th>Status</th><th>Prazo</th><th>Ações</th></tr></thead><tbody>{selected.requirements.map(r=><tr key={r.id}><td><code>{r.code}</code></td><td>{r.title}{r.required?" · obrigatório":""}{r.notes&&<><br/><small>{r.notes}</small></>}</td><td>{r.status}</td><td>{r.dueAt?formatDateTimeBR(r.dueAt):"—"}</td><td><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>void reqStatus(r,"READY")}>Pronto</button><button type="button" className="secondaryLink" onClick={()=>void reqStatus(r,"SUBMITTED")}>Enviado</button><button type="button" className="primaryButton" onClick={()=>void reqStatus(r,"ACCEPTED")}>Aceito</button><button type="button" className="secondaryLink" onClick={()=>void reqStatus(r,"REJECTED")}>Rejeitado</button></div></td></tr>)}</tbody></table></div>

   <form className="incidentForm compactForm" onSubmit={addRequirement}><h3>Adicionar requisito</h3><div className="formGrid"><label>Código<input name="code" required/></label><label>Descrição<input name="title" required/></label><label>Prazo<input name="dueAt" type="datetime-local"/></label><label><input name="required" type="checkbox" defaultChecked/> Obrigatório</label></div><label>Observações<input name="notes"/></label><button className="secondaryLink" disabled={busy}>Adicionar requisito</button></form>

   <h3>Histórico</h3>
   <div className="adminTableWrap"><table><thead><tr><th>Horário</th><th>Evento</th><th>Alteração</th><th>Servidor</th></tr></thead><tbody>{selected.events.map(e=><tr key={e.id}><td>{formatDateTimeBR(e.occurredAt)}</td><td>{e.eventType}</td><td>{e.fromStatus||e.toStatus?(e.fromStatus??"—")+" → "+(e.toStatus??"—"):"—"}{e.notes&&<><br/><small>{e.notes}</small></>}</td><td>matrícula {e.actorMatricula}<br/><small>{e.actorName}</small></td></tr>)}</tbody></table></div>
  </section>}
 </main>;
}
