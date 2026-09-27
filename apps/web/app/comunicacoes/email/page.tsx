"use client";
import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Status={configured:boolean;smtp:{host:string;port:number;secure:boolean};imap:{host:string;port:number;secure:boolean};webmailUrl:string;mailboxLabel:string};
type MailItem={uid:string;from:string|null;subject:string|null;date:string|null;messageId:string|null};

export default function InstitutionalEmailPage(){
 const[status,setStatus]=useState<Status|null>(null),[items,setItems]=useState<MailItem[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const request=useCallback(async(path:string,init?:RequestInit)=>{const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});if(r.status===401){location.href="/login";throw new Error("Sessão expirada.")}const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message??b.error??"Falha no e-mail institucional.");return b},[]);
 const load=useCallback(async()=>{setMessage("");try{const s=await request("/api/v1/institutional-mail/status");setStatus(s);if(s.configured){const b=await request("/api/v1/institutional-mail/inbox?limit=25");setItems(b.items??[])}}catch(e){setMessage(e instanceof Error?e.message:"Falha ao consultar e-mail institucional.")}},[request]);
 useEffect(()=>{void load()},[load]);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage("");const f=new FormData(e.currentTarget);const split=(name:string)=>String(f.get(name)||"").split(/[;,]/).map(x=>x.trim()).filter(Boolean);try{const r=await request("/api/v1/institutional-mail/send",{method:"POST",body:JSON.stringify({to:split("to"),cc:split("cc"),subject:String(f.get("subject")||""),text:String(f.get("text")||"")})});setMessage("Mensagem enviada pelo e-mail institucional"+(r.messageId?" · ID "+r.messageId:"")+".");e.currentTarget.reset();await load()}catch(err){setMessage(err instanceof Error?err.message:"Falha no envio.")}finally{setBusy(false)}}
 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">COMUNICAÇÕES · E-MAIL INSTITUCIONAL · {SIGDEC_VERSION_LABEL}</span><h1>Webmail da Prefeitura</h1><p>Envio SMTP e consulta somente leitura da caixa de entrada institucional pelo SIGDEC.</p></div><div className="headerActions"><Link className="secondaryLink" href="/comunicacoes">Comunicações</Link>{status?.webmailUrl&&<a className="primaryButton" href={status.webmailUrl} target="_blank" rel="noopener noreferrer">Abrir Webmail ↗</a>}</div></header>
  <section className={status?.configured?"infoCard":"warningCard"}><strong>{status?.configured?"Integração configurada":"Integração aguardando credenciais do servidor"}</strong><p>{status?<>SMTP: {status.smtp.host}:{status.smtp.port} · IMAP: {status.imap.host}:{status.imap.port}. As credenciais não são exibidas nem enviadas ao navegador.</>:"Carregando..."}</p></section>
  {message&&<section className="infoCard">{message}</section>}
  <section className="operationsGrid" style={{marginTop:18}}>
   <form className="incidentForm compactForm" onSubmit={send}><h2>Nova mensagem</h2><label>Para<input name="to" type="text" required placeholder="destinatario@ubatuba.sp.gov.br"/></label><label>CC<input name="cc" type="text" placeholder="separe por vírgula ou ponto e vírgula"/></label><label>Assunto<input name="subject" required maxLength={500}/></label><label>Mensagem<textarea name="text" required style={{minHeight:220}}/></label><p><small>O envio é uma ação humana explícita. A IA do SIGDEC não pode disparar e-mail automaticamente.</small></p><button className="primaryButton" disabled={busy||!status?.configured}>{busy?"Enviando...":"Enviar e-mail"}</button></form>
   <section><div className="listHeader"><div><h2>Caixa de entrada</h2><p>Últimas mensagens recebidas. Consulta IMAP em modo somente leitura.</p></div><button type="button" className="secondaryButton" onClick={()=>void load()} disabled={busy}>Atualizar</button></div><div className="dataGrid">{!status?.configured?<div className="warningCard">Configure a conta institucional no servidor para carregar a caixa de entrada.</div>:items.length===0?<div className="infoCard">Nenhuma mensagem encontrada ou caixa ainda não consultada.</div>:items.map(x=><article className="card" key={x.uid}><span className="eyebrow">UID {x.uid}</span><h3>{x.subject??"(sem assunto)"}</h3><p><strong>De:</strong> {x.from??"não informado"}</p><p><small>{x.date??"data não informada"}</small></p>{status.webmailUrl&&<a className="secondaryLink" href={status.webmailUrl} target="_blank" rel="noopener noreferrer">Ler no Webmail ↗</a>}</article>)}</div></section>
  </section>
 </main>
}
