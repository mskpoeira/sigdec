"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type PublicIntegrity={
 valid:boolean;
 artifactHash:string;
 manifestHash:string;
 protocol:string;
 revision:number;
 schemaVersion:string;
 sealedAt:string;
 ed25519:{keyId:string;publicKeyFingerprint:string;attestedAt:string;valid:boolean};
 timestamp:{keyId:string;statementHash:string;timestampedAt:string;publicKeyFingerprint:string;valid:boolean};
 archive:{preserved:boolean;lockMode?:string|null;retainUntil?:string|null;legalHold?:boolean;archivedAt?:string|null;existsRemote?:boolean|null;hashValid?:boolean|null;verifiedAt?:string|null};
 replication:{enabled:boolean;created:boolean;primaryHashValid?:boolean|null;replicaHashValid?:boolean|null;crossHashValid?:boolean|null;policyAligned:boolean;verifiedAt?:string|null};
};

export default function PublicIntegrityPage(){
 const params=useParams<{hash:string}>();
 const hash=String(params?.hash??"");
 const [data,setData]=useState<PublicIntegrity|null>(null);
 const [error,setError]=useState("");

 useEffect(()=>{
  if(!hash)return;
  void fetch(`${API}/api/v1/public/sidec-integrity/${encodeURIComponent(hash)}`)
   .then(async response=>{
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error??"Comprovante público não localizado.");
    setData(body);setError("");
   }).catch(e=>setError(e instanceof Error?e.message:"Falha ao consultar integridade."));
 },[hash]);

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div>
    <span className="eyebrow">SIGDEC · INTEGRIDADE PÚBLICA</span>
    <h1>Consulta de artefato SIDEC</h1>
    <p>Verificação pública do estado criptográfico registrado pelo SIGDEC.</p>
   </div>
   <Link className="secondaryLink" href="/verificar-integridade">Verificar arquivo JSON</Link>
  </header>

  {!data&&!error&&<section className="infoCard">Consultando integridade...</section>}
  {error&&<section className="warningCard">{error}</section>}

  {data&&<section className={data.valid?"infoCard":"warningCard"}>
   <h2>{data.valid?"✓ Integridade criptográfica válida":"⚠ Integridade não confirmada"}</h2>
   <div className="dataGrid">
    <article className="card"><h2>Ocorrência</h2><p>{data.protocol} · revisão {data.revision}</p><p>Schema {data.schemaVersion}</p></article>
    <article className="card"><h2>Ed25519</h2><p><strong>{data.ed25519.valid?"Válido":"Inválido"}</strong></p><p>keyId: {data.ed25519.keyId}</p></article>
    <article className="card"><h2>Carimbo interno</h2><p><strong>{data.timestamp.valid?"Válido":"Inválido"}</strong></p><p>{new Date(data.timestamp.timestampedAt).toLocaleString("pt-BR")}</p></article>
   </div>
   <p style={{overflowWrap:"anywhere"}}><strong>ZIP SHA-256:</strong> {data.artifactHash}</p>
   <p style={{overflowWrap:"anywhere"}}><strong>Manifesto SHA-256:</strong> {data.manifestHash}</p>
   <p style={{overflowWrap:"anywhere"}}><strong>Fingerprint Ed25519:</strong> {data.ed25519.publicKeyFingerprint}</p>
   <p style={{overflowWrap:"anywhere"}}><strong>Statement do timestamp:</strong> {data.timestamp.statementHash}</p>
   <div className="dataGrid">
    <article className="card"><h2>Preservação WORM</h2><p><strong>{data.archive.preserved?"Arquivado":"Ainda não arquivado"}</strong></p>{data.archive.preserved&&<><p>{data.archive.lockMode??"Legal hold"}</p><p>{data.archive.hashValid===true?"SHA-256 remoto confirmado":data.archive.hashValid===false?"Divergência detectada":"Verificação remota pendente"}</p>{data.archive.retainUntil&&<p>Reter até {new Date(data.archive.retainUntil).toLocaleString("pt-BR")}</p>}{data.archive.legalHold&&<p>Legal hold ativo</p>}</>}</article>
   </div>
   <div className="dataGrid">
    <article className={data.replication.enabled&&(!data.replication.created||data.replication.crossHashValid===false||!data.replication.policyAligned)?"warningCard":"card"}><h2>Redundância WORM</h2><p><strong>{!data.replication.enabled?"Não configurada":!data.replication.created?"Réplica ausente":data.replication.crossHashValid===false?"Hashes divergentes":!data.replication.policyAligned?"Política divergente":"Redundância saudável"}</strong></p>{data.replication.created&&<><p>Primário: {data.replication.primaryHashValid===true?"íntegro":data.replication.primaryHashValid===false?"divergente":"não confirmado"}</p><p>Réplica: {data.replication.replicaHashValid===true?"íntegra":data.replication.replicaHashValid===false?"divergente":"não confirmada"}</p>{data.replication.verifiedAt&&<p>Réplica verificada em {new Date(data.replication.verifiedAt).toLocaleString("pt-BR")}</p>}</>}</article>
   </div>
   <p>Selado em {new Date(data.sealedAt).toLocaleString("pt-BR")}.</p>
   <p><small>O carimbo apresentado é interno ao SIGDEC e assinado por Ed25519. Não equivale a carimbo do tempo de autoridade externa ou ICP-Brasil.</small></p>
  </section>}
 </main>;
}
