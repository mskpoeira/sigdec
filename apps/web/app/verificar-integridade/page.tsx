"use client";

import Link from "next/link";
import { ChangeEvent,useState } from "react";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type VerificationResult={
 valid:boolean;
 asymmetricValid:boolean;
 timestampValid?:boolean|null;
 hmacValid:boolean|null;
 registeredArtifact:boolean;
 proofVersion:string;
 publicKeyFingerprint:string;
};

export default function VerifyIntegrityPage(){
 const [raw,setRaw]=useState("");
 const [result,setResult]=useState<VerificationResult|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [auditHash,setAuditHash]=useState("");

 async function verifyProof(){
  setBusy(true);setMessage("");setResult(null);
  let proof:unknown;
  try{proof=JSON.parse(raw)}catch{setMessage("O comprovante não contém JSON válido.");setBusy(false);return}
  try{
   const response=await fetch(`${API}/api/v1/sidec/verify-integrity-proof`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(proof)
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.message??body.error??"Não foi possível verificar o comprovante.");
   setResult(body);
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao verificar comprovante.");}
  finally{setBusy(false)}
 }

 async function loadFile(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];
  if(!file)return;
  try{
   const text=await file.text();
   JSON.parse(text);
   setRaw(text);setResult(null);setMessage("");
  }catch{
   setMessage("O arquivo selecionado não contém um comprovante JSON válido.");
  }
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div>
    <span className="eyebrow">SIGDEC · INTEGRIDADE · {SIGDEC_VERSION_LABEL}</span>
    <h1>Verificar comprovante SIDEC</h1>
    <p>Validação criptográfica independente do comprovante de um ZIP selado, sem necessidade de acesso à chave privada do SIGDEC.</p>
   </div>
   <Link className="secondaryLink" href="/painel">Painel</Link>
  </header>

  <section className="infoCard">
   <strong>Checkpoint da auditoria</strong>
   <p>Consulte publicamente uma âncora SHA-256 da trilha de atividades sem expor o conteúdo auditado.</p>
   <div className="headerActions"><input value={auditHash} onChange={e=>setAuditHash(e.target.value.trim())} placeholder="Hash SHA-256 do checkpoint"/><Link className="secondaryLink" href={auditHash&&/^[a-f0-9]{64}$/i.test(auditHash)?`/integridade/auditoria/${auditHash}`:"/verificar-integridade"} aria-disabled={!/^[a-f0-9]{64}$/i.test(auditHash)}>Verificar checkpoint</Link></div>
  </section>

  <section className="infoCard">
   <strong>O que é validado</strong>
   <p>A assinatura Ed25519 vincula o SHA-256 do manifesto ao SHA-256 do ZIP. A chave pública e seu fingerprint fazem parte do próprio comprovante. A validação HMAC aparece quando a chave histórica correspondente está disponível no servidor.</p>
  </section>

  <section className="incidentForm" style={{marginTop:16}}>
   <label>Carregar comprovante JSON
    <input type="file" accept=".json,application/json" onChange={e=>void loadFile(e)}/>
   </label>
   <label>Ou cole o conteúdo
    <textarea rows={18} value={raw} onChange={e=>setRaw(e.target.value)} placeholder='{"proofVersion":"sigdec-sidec-integrity-proof/1.0",...}'/>
   </label>
   <button className="primaryButton" type="button" disabled={busy||!raw.trim()} onClick={()=>void verifyProof()}>
    {busy?"Verificando...":"Verificar integridade"}
   </button>
  </section>

  {message&&<section className="warningCard" style={{marginTop:16}}>{message}</section>}

  {result&&<section className={result.valid?"infoCard":"warningCard"} style={{marginTop:16}}>
   <h2>{result.valid?"✓ Comprovante criptograficamente válido":"⚠ Comprovante inválido"}</h2>
   <div className="dataGrid">
    <article className="card"><h2>Ed25519</h2><p><strong>{result.asymmetricValid?"Válido":"Inválido"}</strong></p></article>
    <article className="card"><h2>Carimbo interno</h2><p><strong>{result.timestampValid===undefined||result.timestampValid===null?"Não aplicável (proof 1.0)":result.timestampValid?"Válido":"Inválido"}</strong></p></article>
    <article className="card"><h2>HMAC interno</h2><p><strong>{result.hmacValid===null?"Não disponível":result.hmacValid?"Válido":"Inválido"}</strong></p></article>
    <article className="card"><h2>Registro SIGDEC</h2><p><strong>{result.registeredArtifact?"Hash corresponde a artefato registrado":"Sem correspondência confirmada"}</strong></p></article>
   </div>
   <p style={{overflowWrap:"anywhere"}}><strong>Fingerprint da chave pública:</strong> {result.publicKeyFingerprint}</p>
   <p><small>Uma assinatura Ed25519 válida comprova que o par de hashes apresentado foi assinado pela chave privada correspondente à chave pública contida no comprovante. A correspondência com um artefato registrado confirma adicionalmente que esses hashes existem no SIGDEC consultado.</small></p>
  </section>}
 </main>;
}
