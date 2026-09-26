"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {formatDateTimeBR} from "../../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Plan={id:string;code:string;version:number;title:string;status:string;currentLevel:string};
type ReadinessState="READY"|"PENDING"|"UNAVAILABLE";
type Operational={
 plan:Plan;active:boolean;
 activation:{id:string;fromLevel:string;toLevel:string;reason:string;actorMatricula:string;occurredAt:string}|null;
 readiness:{
  overall:ReadinessState;
  calls:{state:ReadinessState;acknowledged:number;required:number};
  checklist:{state:ReadinessState;done:number;required:number};
  teams:{state:ReadinessState;available:number;total:number};
  vehicles:{state:ReadinessState;available:number;total:number};
  communications:{state:ReadinessState;available:number;total:number};
  shelters:{state:ReadinessState;ready:number;total:number};
  inventory:{state:ReadinessState;positive:number;total:number};
 };
 callTargets:Array<{id:string;sequenceNo:number;targetName:string;organizationName:string|null;roleName:string|null;contact:string|null;channel:string;required:boolean;latestStatus:string|null;latestNotes:string|null;latestAt:string|null;latestActorMatricula:string|null}>;
 checklist:Array<{id:string;level:string;sequenceNo:number;title:string;required:boolean;latestStatus:string|null;latestNotes:string|null;latestAt:string|null;latestActorMatricula:string|null}>;
 resources:Array<{id:string;resourceType:string;resourceId:string|null;resourceLabel:string;eventType:string;quantity:number|null;unit:string|null;notes:string|null;actorMatricula:string;occurredAt:string}>;
 linkedIncidents:Array<{id:string;incidentId:string;protocol:string;summary:string;status:string;priority:string;linkedByMatricula:string;linkedAt:string}>;
 activations:Array<{id:string;fromLevel:string;toLevel:string;reason:string;actorMatricula:string;actorName:string;occurredAt:string}>;
 availableResources:{
  teams:Array<{id:string;code:string;name:string;status:string}>;
  vehicles:Array<{id:string;code:string;plate:string|null;description:string;status:string}>;
  inventory:Array<{id:string;code:string;name:string;unit:string;balance:number}>;
  communications:Array<{id:string;code:string;description:string;status:string;channel:string|null}>;
  shelters:Array<{id:string;name:string;status:string;capacityPeople:number}>;
 };
};

const levelName:Record<string,string>={NORMAL:"Normal",OBSERVATION:"Observação",ATTENTION:"Atenção",ALERT:"Alerta",EMERGENCY:"Emergência"};
const callStatus:Record<string,string>={CALLED:"Acionado",ACKNOWLEDGED:"Confirmado",UNREACHABLE:"Sem resposta",SKIPPED:"Dispensado",RESET:"Reaberto"};
const checklistStatus:Record<string,string>={DONE:"Concluído",NOT_APPLICABLE:"Não aplicável",REOPENED:"Reaberto"};
const resourceTypes=[["TEAM","Equipe"],["VEHICLE","Viatura"],["INVENTORY","Estoque"],["COMMUNICATION","Comunicação"],["MANUAL","Outro recurso"]] as const;
const stateText=(state:ReadinessState)=>state==="READY"?"PRONTO":state==="UNAVAILABLE"?"INDISPONÍVEL":"PENDENTE";
const stateClass=(state:ReadinessState)=>state==="READY"?"card":"warningCard";

export default function PlanconOperationalPage(){
 const[plans,setPlans]=useState<Plan[]>([]);
 const[planId,setPlanId]=useState("");
 const[data,setData]=useState<Operational|null>(null);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);
 const[resourceType,setResourceType]=useState("TEAM");

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const response=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(response.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.message??body.error??"Não foi possível concluir a operação.");
  return body;
 },[]);

 const loadPlans=useCallback(async()=>{
  const body=await request("/api/v1/plancon"),items=body.items??[];
  setPlans(items);
  if(!planId){
   const preferred=items.find((x:Plan)=>x.currentLevel!=="NORMAL")??items.find((x:Plan)=>x.status==="ACTIVE"||x.status==="APPROVED")??items[0];
   if(preferred)setPlanId(preferred.id);
  }
 },[request,planId]);

 const loadOperational=useCallback(async(id:string)=>{
  if(!id){setData(null);return}
  const body=await request("/api/v1/plancon/"+id+"/operational");
  setData(body);
 },[request]);

 useEffect(()=>{void loadPlans().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar PLANCON."))},[loadPlans]);
 useEffect(()=>{if(planId)void loadOperational(planId).catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar operação."))},[planId,loadOperational]);

 async function perform(fn:()=>Promise<void>){
  setBusy(true);setMessage("");
  try{await fn();await loadPlans();if(planId)await loadOperational(planId)}
  catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}
  finally{setBusy(false)}
 }

 async function callEvent(targetId:string,status:string){
  let notes="";
  if(status==="UNREACHABLE"||status==="SKIPPED"){
   notes=window.prompt("Justificativa obrigatória:")?.trim()??"";
   if(notes.length<3)return;
  }
  await perform(async()=>{await request("/api/v1/plancon/"+planId+"/call-targets/"+targetId+"/events",{method:"POST",body:JSON.stringify({status,notes})})});
 }

 async function checklistEvent(itemId:string,status:string){
  let notes="";
  if(status==="NOT_APPLICABLE"){
   notes=window.prompt("Justificativa para marcar como não aplicável:")?.trim()??"";
   if(notes.length<3)return;
  }
  await perform(async()=>{await request("/api/v1/plancon/"+planId+"/checklist/"+itemId+"/events",{method:"POST",body:JSON.stringify({status,notes})})});
 }

 async function addTarget(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/plancon/"+planId+"/call-targets",{method:"POST",body:JSON.stringify({
    targetName:String(d.get("targetName")??""),organizationName:String(d.get("organizationName")??""),
    roleName:String(d.get("roleName")??""),contact:String(d.get("contact")??""),channel:String(d.get("channel")??"OTHER"),
    required:d.get("required")==="on"
   })});form.reset();setMessage("Contato incluído no plano de chamada desta versão.");
  });
 }

 async function addChecklist(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/plancon/"+planId+"/checklist-items",{method:"POST",body:JSON.stringify({
    level:String(d.get("level")??"EMERGENCY"),title:String(d.get("title")??""),required:d.get("required")==="on"
   })});form.reset();setMessage("Item incluído no checklist.");
  });
 }

 const resourceOptions=useMemo(()=>{
  if(!data)return [];
  if(resourceType==="TEAM")return data.availableResources.teams.map(x=>({id:x.id,label:x.code+" · "+x.name+" · "+x.status}));
  if(resourceType==="VEHICLE")return data.availableResources.vehicles.map(x=>({id:x.id,label:x.code+" · "+x.description+" · "+x.status}));
  if(resourceType==="INVENTORY")return data.availableResources.inventory.map(x=>({id:x.id,label:x.code+" · "+x.name+" · saldo "+Number(x.balance).toLocaleString("pt-BR")+" "+x.unit}));
  if(resourceType==="COMMUNICATION")return data.availableResources.communications.map(x=>({id:x.id,label:x.code+" · "+x.description+" · "+x.status}));
  return [];
 },[data,resourceType]);

 async function resourceEvent(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),q=String(d.get("quantity")??"").trim();
  await perform(async()=>{
   await request("/api/v1/plancon/"+planId+"/resources/events",{method:"POST",body:JSON.stringify({
    resourceType,eventType:String(d.get("eventType")??"MOBILIZED"),resourceId:resourceType==="MANUAL"?undefined:String(d.get("resourceId")??""),
    resourceLabel:resourceType==="MANUAL"?String(d.get("resourceLabel")??""):"",
    quantity:q?Number(q):undefined,unit:String(d.get("unit")??""),notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Movimentação operacional registrada.");
  });
 }

 async function linkIncident(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{
   await request("/api/v1/plancon/"+planId+"/incidents",{method:"POST",body:JSON.stringify({protocol:String(d.get("protocol")??"")})});
   form.reset();setMessage("Ocorrência vinculada à ativação atual.");
  });
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · OPERAÇÃO PLANCON · {SIGDEC_VERSION_LABEL}</span><h1>Console Operacional e Prontidão</h1>
    <p>Plano de chamada, checklist por nível, mobilização de recursos, ocorrências vinculadas e histórico da ativação.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/planejamento">Planejamento</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}
  <section className="incidentForm compactForm">
   <label>PLANCON operacional<select value={planId} onChange={e=>setPlanId(e.target.value)}>{plans.map(p=><option key={p.id} value={p.id}>{p.code} · v{p.version} · {levelName[p.currentLevel]??p.currentLevel}</option>)}</select></label>
  </section>

  {data&&<>
   <section className={stateClass(data.readiness.overall)} style={{marginTop:16}}>
    <div className="listHeader"><div><h2>Prontidão geral: {stateText(data.readiness.overall)}</h2><p>{data.plan.code} · v{data.plan.version} · nível {levelName[data.plan.currentLevel]??data.plan.currentLevel}</p></div><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void loadOperational(planId)}>Atualizar</button></div>
    {data.activation?<p><strong>Última ativação:</strong> {formatDateTimeBR(data.activation.occurredAt)} · matrícula {data.activation.actorMatricula}<br/><small>{data.activation.reason}</small></p>:<p>Nenhuma ativação registrada para esta versão do PLANCON.</p>}
   </section>

   <section className="dataGrid" style={{marginTop:16}}>
    <article className={stateClass(data.readiness.calls.state)}><h2>Plano de chamada</h2><p className="adminNumber">{data.readiness.calls.acknowledged}/{data.readiness.calls.required}</p><p>{stateText(data.readiness.calls.state)} · confirmações obrigatórias</p></article>
    <article className={stateClass(data.readiness.checklist.state)}><h2>Checklist</h2><p className="adminNumber">{data.readiness.checklist.done}/{data.readiness.checklist.required}</p><p>{stateText(data.readiness.checklist.state)} · nível atual</p></article>
    <article className={stateClass(data.readiness.teams.state)}><h2>Equipes</h2><p className="adminNumber">{data.readiness.teams.available}/{data.readiness.teams.total}</p><p>{stateText(data.readiness.teams.state)} · disponíveis</p></article>
    <article className={stateClass(data.readiness.vehicles.state)}><h2>Viaturas</h2><p className="adminNumber">{data.readiness.vehicles.available}/{data.readiness.vehicles.total}</p><p>{stateText(data.readiness.vehicles.state)} · disponíveis</p></article>
    <article className={stateClass(data.readiness.communications.state)}><h2>Comunicações</h2><p className="adminNumber">{data.readiness.communications.available}/{data.readiness.communications.total}</p><p>{stateText(data.readiness.communications.state)}</p></article>
    <article className={stateClass(data.readiness.shelters.state)}><h2>Abrigos</h2><p className="adminNumber">{data.readiness.shelters.ready}/{data.readiness.shelters.total}</p><p>{stateText(data.readiness.shelters.state)} · prontidão/abertos</p></article>
    <article className={stateClass(data.readiness.inventory.state)}><h2>Estoque</h2><p className="adminNumber">{data.readiness.inventory.positive}/{data.readiness.inventory.total}</p><p>{stateText(data.readiness.inventory.state)} · itens com saldo</p></article>
   </section>

   <section style={{marginTop:24}}>
    <h2>Plano de chamada executável</h2>
    {!data.active&&<div className="warningCard">Ative o PLANCON acima do nível Normal para registrar acionamentos.</div>}
    <div className="adminTableWrap"><table><thead><tr><th>Ordem</th><th>Contato</th><th>Canal</th><th>Situação</th><th>Último registro</th><th>Ações</th></tr></thead>
     <tbody>{data.callTargets.map(x=><tr key={x.id}><td>{x.sequenceNo}</td><td><strong>{x.targetName}</strong>{x.organizationName&&<><br/><small>{x.organizationName}</small></>}{x.roleName&&<><br/><small>{x.roleName}</small></>}{x.contact&&<><br/><small>{x.contact}</small></>}</td><td>{x.channel}{x.required?" · obrigatório":""}</td><td>{callStatus[x.latestStatus??""]??"Pendente"}</td><td>{x.latestAt?formatDateTimeBR(x.latestAt):"—"}{x.latestActorMatricula&&<><br/><small>matrícula {x.latestActorMatricula}</small></>}</td><td><div className="headerActions"><button type="button" className="secondaryLink" disabled={busy||!data.active} onClick={()=>void callEvent(x.id,"CALLED")}>Acionar</button><button type="button" className="primaryButton" disabled={busy||!data.active} onClick={()=>void callEvent(x.id,"ACKNOWLEDGED")}>Confirmou</button><button type="button" className="secondaryLink" disabled={busy||!data.active} onClick={()=>void callEvent(x.id,"UNREACHABLE")}>Sem resposta</button></div></td></tr>)}</tbody>
    </table>{data.callTargets.length===0&&<p>Nenhum contato estruturado no plano de chamada.</p>}</div>
    <form className="incidentForm compactForm" onSubmit={addTarget}><h3>Adicionar contato ao plano</h3><div className="formGrid"><label>Nome / órgão<input name="targetName" required/></label><label>Instituição<input name="organizationName"/></label><label>Função<input name="roleName"/></label><label>Contato<input name="contact"/></label><label>Canal<select name="channel"><option value="PHONE">Telefone</option><option value="WHATSAPP">WhatsApp</option><option value="RADIO">Rádio</option><option value="EMAIL">E-mail</option><option value="OTHER">Outro</option></select></label><label><input type="checkbox" name="required" defaultChecked/> Confirmação obrigatória</label></div><button className="secondaryLink" disabled={busy}>Adicionar</button></form>
   </section>

   <section style={{marginTop:24}}>
    <h2>Checklist do nível {levelName[data.plan.currentLevel]??data.plan.currentLevel}</h2>
    <div className="dataGrid">{data.checklist.map(x=><article className={x.latestStatus==="DONE"||x.latestStatus==="NOT_APPLICABLE"?"card":"warningCard"} key={x.id}><h3>{x.sequenceNo}. {x.title}</h3><p>{checklistStatus[x.latestStatus??""]??"Pendente"}{x.required?" · obrigatório":""}</p>{x.latestAt&&<p><small>{formatDateTimeBR(x.latestAt)} · matrícula {x.latestActorMatricula}</small></p>}<div className="headerActions"><button type="button" className="primaryButton" disabled={busy||!data.active} onClick={()=>void checklistEvent(x.id,"DONE")}>Concluir</button><button type="button" className="secondaryLink" disabled={busy||!data.active} onClick={()=>void checklistEvent(x.id,"NOT_APPLICABLE")}>Não aplicável</button>{x.latestStatus&&x.latestStatus!=="REOPENED"&&<button type="button" className="secondaryLink" disabled={busy||!data.active} onClick={()=>void checklistEvent(x.id,"REOPENED")}>Reabrir</button>}</div></article>)}</div>
    {data.checklist.length===0&&<div className="warningCard">Nenhum item configurado para este nível operacional.</div>}
    <form className="incidentForm compactForm" onSubmit={addChecklist}><h3>Adicionar item de checklist</h3><div className="formGrid"><label>Nível<select name="level" defaultValue={data.plan.currentLevel}>{["NORMAL","OBSERVATION","ATTENTION","ALERT","EMERGENCY"].map(x=><option key={x} value={x}>{levelName[x]}</option>)}</select></label><label>Procedimento<input name="title" required/></label><label><input type="checkbox" name="required" defaultChecked/> Obrigatório</label></div><button className="secondaryLink" disabled={busy}>Adicionar</button></form>
   </section>

   <section style={{marginTop:24}}>
    <h2>Mobilização e desmobilização</h2>
    <form className="incidentForm compactForm" onSubmit={resourceEvent}><div className="formGrid">
     <label>Tipo<select value={resourceType} onChange={e=>setResourceType(e.target.value)}>{resourceTypes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     {resourceType!=="MANUAL"?<label>Recurso<select name="resourceId" required>{resourceOptions.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>:<label>Descrição<input name="resourceLabel" required/></label>}
     <label>Ação<select name="eventType"><option value="MOBILIZED">Mobilizar</option><option value="DEMOBILIZED">Desmobilizar</option></select></label>
     <label>Quantidade<input name="quantity" type="number" min="0.01" step="0.01"/></label><label>Unidade<input name="unit"/></label>
    </div><label>Observações<input name="notes"/></label><button className="primaryButton" disabled={busy||!data.active}>Registrar recurso</button></form>
    <div className="dataGrid">{data.resources.map(x=><article className={x.eventType==="MOBILIZED"?"card":"warningCard"} key={x.id}><h3>{x.resourceLabel}</h3><p><strong>{x.eventType==="MOBILIZED"?"Mobilizado":"Desmobilizado"}</strong> · {x.resourceType}</p>{x.quantity&&<p>{x.quantity} {x.unit??""}</p>}<p><small>{formatDateTimeBR(x.occurredAt)} · matrícula {x.actorMatricula}</small></p></article>)}</div>
   </section>

   <section style={{marginTop:24}}>
    <h2>Ocorrências vinculadas à ativação</h2>
    <form className="incidentForm compactForm" onSubmit={linkIncident}><div className="formGrid"><label>Protocolo SIGDEC<input name="protocol" required placeholder="DC-AAAA-MM-DD000000"/></label></div><button className="primaryButton" disabled={busy||!data.active}>Vincular ocorrência</button></form>
    <div className="dataGrid">{data.linkedIncidents.map(x=><article className="card" key={x.id}><h3>{x.protocol}</h3><p>{x.summary}</p><p>{x.priority} · {x.status}</p><p><small>Vinculada em {formatDateTimeBR(x.linkedAt)} · matrícula {x.linkedByMatricula}</small></p><Link className="secondaryLink" href={"/ocorrencias/"+x.incidentId}>Abrir ocorrência</Link></article>)}</div>
   </section>

   <section style={{marginTop:24}}>
    <h2>Histórico de ativação</h2>
    <div className="adminTableWrap"><table><thead><tr><th>Horário</th><th>Nível</th><th>Motivo</th><th>Servidor</th></tr></thead><tbody>{data.activations.map(x=><tr key={x.id}><td>{formatDateTimeBR(x.occurredAt)}</td><td>{levelName[x.fromLevel]} → <strong>{levelName[x.toLevel]}</strong></td><td>{x.reason}</td><td>matrícula {x.actorMatricula}<br/><small>{x.actorName}</small></td></tr>)}</tbody></table></div>
   </section>
  </>}
 </main>;
}
