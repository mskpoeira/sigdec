"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent,useCallback,useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type SidecExport={
 id:string;
 revision:number;
 schemaVersion:string;
 status:string;
 snapshotHash:string;
 externalProtocol?:string|null;
 externalNotes?:string|null;
 exportedAt?:string|null;
 submittedAt?:string|null;
 acknowledgedAt?:string|null;
 rejectedAt?:string|null;
 createdAt:string;
 updatedAt:string;
};

const statusLabels:Record<string,string>={
 READY:"Pronto para exportação",
 EXPORTED:"Exportado",
 SUBMITTED:"Protocolado no SIDEC",
 ACKNOWLEDGED:"Recebimento confirmado",
 REJECTED:"Rejeitado / devolvido",
 CANCELLED:"Cancelado"
};

export default function SidecExportsPage(){
 const params=useParams<{id:string}>(),incidentId=params.id;
 const [items,setItems]=useState<SidecExport[]>([]);
 const [protocols,setProtocols]=useState<Record<string,string>>({});
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [message,setMessage]=useState("Carregando pacotes...");
 const [busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const response=await fetch(`${API}${path}`,{credentials:"include",...init,headers:{"Content-Type":"application/json",...(init?.headers??{})}});
  if(response.status===401){location.href="/login";return null}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.message??body.error??"Não foi possível concluir a operação.");
  return body;
 },[]);

 const load=useCallback(async()=>{
  try{
   const body=await request(`/api/v1/incidents/${incidentId}/sidec-exports`);
   setItems(body?.items??[]);setMessage("");
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar pacotes SIDEC.");}
 },[incidentId,request]);

 useEffect(()=>{void load()},[load]);

 async function generate(){
  setBusy(true);setMessage("");
  try{
   const body=await request(`/api/v1/incidents/${incidentId}/sidec-exports`,{method:"POST",body:"{}"});
   setMessage(`Pacote SIDEC revisão ${body?.revision??""} gerado com sucesso.`);
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao gerar pacote SIDEC.");}
  finally{setBusy(false)}
 }

 async function changeStatus(id:string,status:string){
  setBusy(true);setMessage("");
  try{
   await request(`/api/v1/sidec-exports/${id}/status`,{
    method:"PATCH",
    body:JSON.stringify({
     status,
     externalProtocol:protocols[id]?.trim()||undefined,
     externalNotes:notes[id]?.trim()||undefined
    })
   });
   setMessage("Situação do pacote SIDEC atualizada.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao atualizar pacote SIDEC.");}
  finally{setBusy(false)}
 }

 function downloadUrl(id:string,format:"json"|"csv"){
  return `${API}/api/v1/sidec-exports/${id}/download?format=${format}`;
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">INTEROPERABILIDADE · SIDEC/SP</span><h1>Pacotes da ocorrência</h1><p>Snapshots versionados para lançamento controlado no sistema estadual.</p></div>
   <div className="headerActions"><button className="primaryButton" disabled={busy} type="button" onClick={()=>void generate()}>Gerar nova revisão</button><Link className="secondaryLink" href={`/ocorrencias/${incidentId}`}>Voltar à ocorrência</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}

  <section className="infoCard">
   <strong>Como funciona</strong>
   <p>O SIGDEC prepara os dados e registra cada revisão. O lançamento no SIDEC permanece manual/controlado até existir integração oficial autorizada. Depois do envio, registre aqui o protocolo externo e o retorno recebido.</p>
  </section>

  <section className="dataGrid" style={{marginTop:18}}>
   {items.length===0?<div className="infoCard">Nenhum pacote gerado para esta ocorrência.</div>:items.map(item=>
    <article className="card" key={item.id}>
     <h2>Revisão {item.revision}</h2>
     <p><strong>{statusLabels[item.status]??item.status}</strong> · schema {item.schemaVersion}</p>
     <p>Gerado em {new Date(item.createdAt).toLocaleString("pt-BR")}</p>
     <p style={{overflowWrap:"anywhere"}}><strong>SHA-256:</strong> {item.snapshotHash}</p>
     {item.externalProtocol&&<p><strong>Protocolo externo:</strong> {item.externalProtocol}</p>}
     {item.externalNotes&&<p>{item.externalNotes}</p>}

     <div className="headerActions">
      <a className="secondaryLink" href={downloadUrl(item.id,"json")}>Baixar JSON</a>
      <a className="secondaryLink" href={downloadUrl(item.id,"csv")}>Baixar CSV</a>
     </div>

     {item.status==="READY"&&<div className="headerActions" style={{marginTop:10}}><button className="primaryButton" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"EXPORTED")}>Marcar como exportado</button><button className="secondaryLink" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"CANCELLED")}>Cancelar</button></div>}

     {item.status==="EXPORTED"&&<form onSubmit={(event:FormEvent)=>{event.preventDefault();void changeStatus(item.id,"SUBMITTED")}} className="incidentForm compactForm" style={{marginTop:12}}>
      <label>Protocolo no SIDEC<input required value={protocols[item.id]??item.externalProtocol??""} onChange={e=>setProtocols(p=>({...p,[item.id]:e.target.value}))} placeholder="Número/protocolo externo"/></label>
      <label>Observação<textarea value={notes[item.id]??""} onChange={e=>setNotes(p=>({...p,[item.id]:e.target.value}))}/></label>
      <button className="primaryButton" disabled={busy}>Registrar protocolo e envio</button>
     </form>}

     {item.status==="SUBMITTED"&&<div className="incidentForm compactForm" style={{marginTop:12}}>
      <label>Observação do retorno<textarea value={notes[item.id]??item.externalNotes??""} onChange={e=>setNotes(p=>({...p,[item.id]:e.target.value}))}/></label>
      <div className="headerActions"><button className="primaryButton" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"ACKNOWLEDGED")}>Confirmar recebimento</button><button className="secondaryLink" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"REJECTED")}>Registrar rejeição/devolução</button></div>
     </div>}
    </article>
   )}
  </section>
 </main>;
}