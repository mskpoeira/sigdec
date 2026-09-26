"use client";

import Link from "next/link";
import {useParams} from "next/navigation";
import {useEffect,useState} from "react";
import {formatDateTimeBR} from "../../../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type PublicCheckpoint={
 valid:boolean;
 proofVersion:string;
 organizationName:string;
 createdAt:string;
 auditCount:number;
 firstAuditId:string|null;
 lastAuditId:string|null;
 auditRootHash:string;
 previousCheckpointHash:string|null;
 checkpointHash:string;
 integrityVersion:number;
 algorithm:string;
 verification:{checkpointValid:boolean;rootValid:boolean;previousExists:boolean;invalid:number;unsealed:number};
 checkedAt:string;
};

export default function PublicAuditCheckpointPage(){
 const params=useParams<{hash:string}>();
 const hash=String(params?.hash??"");
 const[data,setData]=useState<PublicCheckpoint|null>(null);
 const[error,setError]=useState("");

 useEffect(()=>{
  if(!hash)return;
  void fetch(`${API}/api/v1/public/audit-checkpoint/${encodeURIComponent(hash)}`,{cache:"no-store"})
   .then(async response=>{
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error??"Checkpoint não localizado.");
    setData(body);setError("");
   }).catch(e=>setError(e instanceof Error?e.message:"Falha ao consultar checkpoint."));
 },[hash]);

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · INTEGRIDADE PÚBLICA · {SIGDEC_VERSION_LABEL}</span><h1>Verificação de checkpoint da auditoria</h1>
    <p>Consulta pública do estado criptográfico de uma âncora da trilha de auditoria, sem exposição do conteúdo das atividades.</p></div>
   <Link className="secondaryLink" href="/verificar-integridade">Outras verificações</Link>
  </header>

  {!data&&!error&&<section className="infoCard">Consultando checkpoint...</section>}
  {error&&<section className="warningCard">{error}</section>}

  {data&&<section className={data.valid?"infoCard":"warningCard"}>
   <h2>{data.valid?"✓ Checkpoint íntegro":"⚠ Integridade não confirmada"}</h2>
   <div className="dataGrid">
    <article className="card"><h2>Órgão</h2><p><strong>{data.organizationName}</strong></p><p>{formatDateTimeBR(data.createdAt)}</p></article>
    <article className="card"><h2>Registros cobertos</h2><p className="adminNumber">{data.auditCount}</p><p>{data.firstAuditId??"—"} → {data.lastAuditId??"—"}</p></article>
    <article className={data.verification.checkpointValid?"card":"warningCard"}><h2>Checkpoint</h2><p><strong>{data.verification.checkpointValid?"Válido":"Inválido"}</strong></p><p>{data.algorithm} · v{data.integrityVersion}</p></article>
    <article className={data.verification.rootValid?"card":"warningCard"}><h2>Raiz da auditoria</h2><p><strong>{data.verification.rootValid?"Confere":"Divergente"}</strong></p><p>{data.verification.invalid} inválido(s) · {data.verification.unsealed} sem selo</p></article>
    <article className={data.verification.previousExists?"card":"warningCard"}><h2>Encadeamento</h2><p><strong>{data.verification.previousExists?"Confirmado":"Anterior não localizado"}</strong></p><p>{data.previousCheckpointHash?"Checkpoint anterior vinculado":"Checkpoint gênese"}</p></article>
   </div>
   <p style={{overflowWrap:"anywhere"}}><strong>Checkpoint SHA-256:</strong> {data.checkpointHash}</p>
   <p style={{overflowWrap:"anywhere"}}><strong>Raiz da auditoria:</strong> {data.auditRootHash}</p>
   {data.previousCheckpointHash&&<p style={{overflowWrap:"anywhere"}}><strong>Checkpoint anterior:</strong> {data.previousCheckpointHash}</p>}
   <p><small>Verificado pelo SIGDEC em {formatDateTimeBR(data.checkedAt)}. A consulta confirma a correspondência do checkpoint com os registros atualmente preservados no sistema, sem revelar o conteúdo da trilha.</small></p>
  </section>}
 </main>;
}
