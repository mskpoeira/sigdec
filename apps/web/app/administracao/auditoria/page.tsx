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
 integrityVersion:number;
 integrityHash:string;
 integrityValid:boolean;
};
type Integrity={status:"verified"|"failed";algorithm:string;appendOnly:boolean;checkedAt:string;total:number;unsealed:number;invalid:number;oldestAt:string|null;newestAt:string|null};
type Checkpoint={id:string;createdAt:string;createdByMatricula:string;createdByName:string;auditCount:number;firstAuditId:string|null;lastAuditId:string|null;auditRootHash:string;previousCheckpointHash:string|null;checkpointHash:string;integrityVersion:number;algorithm:string;checkpointValid:boolean};
type CheckpointVerification={status:"none"|"verified"|"failed";checkedAt:string;checkpointCount:number;chainInvalid?:number;contentInvalid?:number;latest?:Checkpoint;audit?:{rootValid:boolean;invalid:number;unsealed:number}};

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
 const[integrity,setIntegrity]=useState<Integrity|null>(null);
 const[checkpoints,setCheckpoints]=useState<Checkpoint[]>([]);
 const[checkpointVerification,setCheckpointVerification]=useState<CheckpointVerification|null>(null);
 const[checkpointBusy,setCheckpointBusy]=useState(false);
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

 const verify=useCallback(async()=>{
  try{
   const response=await fetch(`${API}/api/v1/admin/audit/verify`,{credentials:"include",cache:"no-store"});
   const body=await response.json().catch(()=>({}));
   if(response.ok)setIntegrity(body);
  }catch{}
 },[]);
 const loadCheckpoints=useCallback(async()=>{
  try{
   const [listResponse,verifyResponse]=await Promise.all([
    fetch(`${API}/api/v1/admin/audit/checkpoints?limit=20`,{credentials:"include",cache:"no-store"}),
    fetch(`${API}/api/v1/admin/audit/checkpoints/verify`,{credentials:"include",cache:"no-store"})
   ]);
   const listBody=await listResponse.json().catch(()=>({}));
   const verifyBody=await verifyResponse.json().catch(()=>({}));
   if(listResponse.ok)setCheckpoints(listBody.items??[]);
   if(verifyResponse.ok)setCheckpointVerification(verifyBody);
  }catch{}
 },[]);
 const createCheckpoint=useCallback(async()=>{
  setCheckpointBusy(true);
  try{
   const response=await fetch(`${API}/api/v1/admin/audit/checkpoints`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:"{}"});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.message??body.error??"Não foi possível criar o ponto de verificação.");
   setMessage("Ponto de verificação criptográfica criado com sucesso.");
   await loadCheckpoints();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao criar ponto de verificação.");}
  finally{setCheckpointBusy(false);}
 },[loadCheckpoints]);
 const downloadCheckpointReceipt=useCallback(async(item:Checkpoint)=>{
  try{
   const response=await fetch(`${API}/api/v1/admin/audit/checkpoints/${encodeURIComponent(item.id)}/receipt`,{credentials:"include",cache:"no-store"});
   if(response.status===401){location.href="/login";return}
   if(!response.ok){
    const body=await response.json().catch(()=>({}));
    throw new Error(body.message??body.error??"Não foi possível gerar o comprovante.");
   }
   const blob=await response.blob();
   const href=URL.createObjectURL(blob);
   const link=document.createElement("a");
   link.href=href;link.download=`sigdec-audit-checkpoint-${item.id}.json`;
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao baixar comprovante.");}
 },[]);
 useEffect(()=>{void load();void verify();void loadCheckpoints()},[verify,loadCheckpoints]);

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

  {integrity&&<section className={integrity.status==="verified"?"infoCard":"warningCard"}><strong>{integrity.status==="verified"?"Integridade verificada":"Falha de integridade detectada"}</strong><p>{integrity.total} registro(s) verificado(s) · {integrity.invalid} inválido(s) · {integrity.unsealed} sem selo · {integrity.algorithm} · trilha {integrity.appendOnly?"append-only":"alterável"}</p><p><small>Verificado em {formatDateTimeBR(integrity.checkedAt)}</small></p></section>}
  <section className={checkpointVerification?.status==="failed"?"warningCard":"infoCard"} style={{marginTop:12}}>
   <div className="listHeader"><div><strong>Cadeia de pontos de verificação</strong><p>{checkpointVerification?.status==="verified"?"Cadeia íntegra e vinculada ao histórico auditado.":checkpointVerification?.status==="failed"?"Inconsistência detectada na cadeia de checkpoints.":"Nenhum checkpoint criado ainda."}</p></div><button className="primaryButton" type="button" disabled={checkpointBusy} onClick={()=>void createCheckpoint()}>{checkpointBusy?"Criando...":"Criar checkpoint"}</button></div>
   {checkpointVerification?.status!=="none"&&checkpointVerification&&<p><small>{checkpointVerification.checkpointCount} checkpoint(s) · {checkpointVerification.chainInvalid??0} quebra(s) de encadeamento · {checkpointVerification.contentInvalid??0} conteúdo(s) inválido(s) · conferido em {formatDateTimeBR(checkpointVerification.checkedAt)}</small></p>}
  </section>
  {message&&<section className="infoCard">{message}</section>}

  {checkpoints.length>0&&<section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Checkpoints criptográficos</h2><p>Âncoras append-only da trilha de auditoria, encadeadas entre si.</p></div></div>
   <div className="adminTableWrap"><table><thead><tr><th>Horário</th><th>Matrícula</th><th>Registros</th><th>Intervalo</th><th>Raiz SHA-256</th><th>Checkpoint</th><th>Comprovante</th></tr></thead>
    <tbody>{checkpoints.map(item=><tr key={item.id}><td>{formatDateTimeBR(item.createdAt)}</td><td><strong>{item.createdByMatricula}</strong><br/><small>{item.createdByName}</small></td><td>{item.auditCount}</td><td>{item.firstAuditId??"—"} → {item.lastAuditId??"—"}</td><td><code title={item.auditRootHash}>{item.auditRootHash.slice(0,16)}…</code></td><td>{item.checkpointValid?"✓ OK":"⚠ FALHA"}</td><td><div className="headerActions"><button className="secondaryLink" type="button" onClick={()=>void downloadCheckpointReceipt(item)}>JSON</button><Link className="secondaryLink" href={`/integridade/auditoria/${item.checkpointHash}`} target="_blank">Ver público</Link></div></td></tr>)}</tbody>
   </table></div>
  </section>}

  <section style={{marginTop:18}}>
   <div className="listHeader"><div><h2>Atividades registradas</h2><p>{items.length} registro(s) exibido(s), do mais recente para o mais antigo.</p></div></div>
   <div className="adminTableWrap">
    <table>
     <thead><tr><th>Horário</th><th>Matrícula</th><th>Servidor</th><th>Atividade</th><th>Tipo</th><th>Registro</th><th>Integridade</th><th>IP</th></tr></thead>
     <tbody>{items.map(item=><tr key={item.id}>
      <td>{formatDateTimeBR(item.occurredAt)}</td>
      <td><strong>{item.actorMatricula??"—"}</strong></td>
      <td>{item.actorName??"—"}</td>
      <td>{activityLabel(item.action)}</td>
      <td>{item.entityType}</td>
      <td><code>{item.entityId??"—"}</code></td>
      <td title={item.integrityHash}>{item.integrityValid?"✓ OK":"⚠ FALHA"}</td>
      <td>{item.ip??"—"}</td>
     </tr>)}</tbody>
    </table>
    {items.length===0&&!message&&<p>Nenhuma atividade encontrada para os filtros selecionados.</p>}
   </div>
  </section>
 </main>;
}
