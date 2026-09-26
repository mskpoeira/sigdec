"use client";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {formatDateTimeBR,ubatubaLocalDateTimeToIso} from "../../lib/datetime";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type AuditItem={
 id:number;
 occurredAt:string;
 actorMatricula:string|null;
 actorName:string|null;
 action:string;
 entityType:string;
 entityId:string|null;
 ip:string|null;
 metadata:Record<string,unknown>|null;
};

const activityLabel=(action:string)=>{
 if(action==="REQUEST_POST")return "Registro";
 if(action==="REQUEST_PUT"||action==="REQUEST_PATCH")return "Alteração";
 if(action==="REQUEST_DELETE")return "Exclusão";
 return action.replaceAll("_"," ");
};

export default function AuditPage(){
 const[items,setItems]=useState<AuditItem[]>([]);
 const[matricula,setMatricula]=useState("");
 const[action,setAction]=useState("");
 const[entityType,setEntityType]=useState("");
 const[from,setFrom]=useState("");
 const[to,setTo]=useState("");
 const[message,setMessage]=useState("Carregando atividades...");
 const[busy,setBusy]=useState(false);

 const params=useMemo(()=>{
  const p=new URLSearchParams();
  if(matricula.trim())p.set("matricula",matricula.trim());
  if(action.trim())p.set("action",action.trim());
  if(entityType.trim())p.set("entityType",entityType.trim());
  if(from)p.set("from",ubatubaLocalDateTimeToIso(from));
  if(to)p.set("to",ubatubaLocalDateTimeToIso(to));
  p.set("limit","200");
  return p;
 },[matricula,action,entityType,from,to]);

 const load=useCallback(async(current=params)=>{
  setBusy(true);
  try{
   const response=await fetch(`${API}/api/v1/admin/audit?${current.toString()}`,{credentials:"include",cache:"no-store"});
   if(response.status===401){location.href="/login";return;}
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.message??body.error??"Não foi possível carregar a auditoria.");
   setItems(body.items??[]);
   setMessage("");
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar a auditoria.");}
  finally{setBusy(false);}
 },[params]);

 useEffect(()=>{void load()},[]);

 function filter(event:FormEvent){event.preventDefault();void load(params)}
 function clear(){
  setMatricula("");setAction("");setEntityType("");setFrom("");setTo("");
  const p=new URLSearchParams({limit:"200"});
  void load(p);
 }
 const exportUrl=`${API}/api/v1/admin/audit.csv?${params.toString()}`;

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · AUDITORIA · {SIGDEC_VERSION_LABEL}</span><h1>Registro de Atividades</h1>
    <p>Trilha cronológica das inclusões, alterações e exclusões, com horário oficial e matrícula do servidor.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/administracao">Administração</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  <form className="incidentForm compactForm" onSubmit={filter}>
   <h2>Filtros</h2>
   <div className="formGrid">
    <label>Matrícula<input value={matricula} onChange={e=>setMatricula(e.target.value)} placeholder="Ex.: 915789"/></label>
    <label>Ação<input value={action} onChange={e=>setAction(e.target.value)} placeholder="Ex.: REQUEST_POST"/></label>
    <label>Tipo de registro<input value={entityType} onChange={e=>setEntityType(e.target.value)} placeholder="Ex.: incident"/></label>
    <label>De<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>Até<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label>
   </div>
   <div className="headerActions">
    <button className="primaryButton" disabled={busy}>{busy?"Consultando...":"Filtrar"}</button>
    <button className="secondaryLink" type="button" disabled={busy} onClick={clear}>Limpar</button>
    <a className="secondaryLink" href={exportUrl}>Exportar CSV</a>
   </div>
  </form>

  {message&&<section className="infoCard">{message}</section>}

  <section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Atividades registradas</h2><p>{items.length} registro(s) exibido(s), do mais recente para o mais antigo.</p></div></div>
   <div className="adminTableWrap">
    <table>
     <thead><tr><th>Horário</th><th>Matrícula</th><th>Servidor</th><th>Atividade</th><th>Tipo</th><th>Registro</th><th>IP</th></tr></thead>
     <tbody>{items.map(item=><tr key={item.id}>
      <td>{formatDateTimeBR(item.occurredAt)}</td>
      <td><strong>{item.actorMatricula??"—"}</strong></td>
      <td>{item.actorName??"—"}</td>
      <td>{activityLabel(item.action)}</td>
      <td>{item.entityType}</td>
      <td><code>{item.entityId??"—"}</code></td>
      <td>{item.ip??"—"}</td>
     </tr>)}</tbody>
    </table>
    {items.length===0&&!message&&<p>Nenhuma atividade encontrada para os filtros selecionados.</p>}
   </div>
  </section>
 </main>;
}
