"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Status={configured:boolean;smtp:{host:string;port:number;secure:boolean;userConfigured:boolean};imap:{host:string;port:number;secure:boolean;userConfigured:boolean};webmailUrl:string;mailboxLabel:string};

export default function InstitutionalMailAdminPage(){
 const[status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function load(){setMessage("");try{const r=await fetch(API+"/api/v1/institutional-mail/status",{credentials:"include",cache:"no-store"});if(r.status===401){location.href="/login";return}const b=await r.json();if(!r.ok)throw new Error(b.message??"Falha.");setStatus(b)}catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar configuração.")}}
 useEffect(()=>{void load()},[]);
 async function test(){setBusy(true);setMessage("");try{const r=await fetch(API+"/api/v1/institutional-mail/test",{method:"POST",credentials:"include"});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message??"Teste falhou.");setMessage("SMTP e IMAP validados com sucesso.")}catch(e){setMessage(e instanceof Error?e.message:"Falha no teste.")}finally{setBusy(false)}}
 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">ADMINISTRAÇÃO · INTEGRAÇÕES · E-MAIL · {SIGDEC_VERSION_LABEL}</span><h1>E-mail institucional</h1><p>Integração segura do SIGDEC com o Webmail da Prefeitura por SMTP e IMAP TLS.</p></div><div className="headerActions"><Link className="secondaryLink" href="/administracao/integracoes">Integrações</Link><Link className="secondaryLink" href="/comunicacoes/email">Abrir caixa no SIGDEC</Link></div></header>
  <nav className="sectionTabs" aria-label="Integrações específicas">
   <Link href="/administracao/integracoes">⇄ Visão geral</Link>
   <Link className="active" href="/administracao/integracoes/email">✉ E-mail institucional</Link>
   <Link href="/administracao/geopixel">⌖ GeoPixel</Link>
   <Link href="/administracao/sei">▤ SEI Cidades</Link>
  </nav>
  {message&&<section className="infoCard">{message}</section>}
  <section className={status?.configured?"infoCard":"warningCard"}><strong>{status?.configured?"Credenciais configuradas no servidor":"Credenciais ainda não configuradas"}</strong><p>Nunca são exibidas nesta tela. O SIGDEC apenas informa se estão presentes.</p></section>
  <section className="dataGrid">
   <article className="card"><span className="eyebrow">WEBMAIL</span><h2>{status?.mailboxLabel??"Prefeitura de Ubatuba"}</h2><p><a href={status?.webmailUrl??"https://webmail.ubatuba.sp.gov.br/"} target="_blank" rel="noopener noreferrer">https://webmail.ubatuba.sp.gov.br/ ↗</a></p><p>Fallback oficial para leitura completa, pastas e demais operações do provedor.</p></article>
   <article className="card"><span className="eyebrow">SMTP</span><h2>Envio</h2><p>{status?.smtp.host??"mail.ubatuba.sp.gov.br"}:{status?.smtp.port??"configurável"} · TLS {status?.smtp.secure?"direto":"STARTTLS/configurável"}</p><p>Usuário: {status?.smtp.userConfigured?"configurado":"não configurado"}</p></article>
   <article className="card"><span className="eyebrow">IMAP</span><h2>Recebimento</h2><p>{status?.imap.host??"mail.ubatuba.sp.gov.br"}:{status?.imap.port??"configurável"} · modo somente leitura</p><p>Usuário: {status?.imap.userConfigured?"configurado":"não configurado"}</p></article>
  </section>
  <section className="detailSection" style={{marginTop:20}}><h2>Configuração no servidor</h2><p>Defina somente no ambiente seguro: <code>INSTITUTIONAL_MAIL_USER</code>, <code>INSTITUTIONAL_MAIL_PASSWORD</code>, portas/hosts SMTP e IMAP quando necessário e o remetente institucional. Não salve a senha em GitHub, navegador ou banco de configuração comum.</p><button type="button" className="primaryButton" onClick={()=>void test()} disabled={busy||!status?.configured}>{busy?"Testando...":"Testar SMTP + IMAP"}</button></section>
 </main>
}
