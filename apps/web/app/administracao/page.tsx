"use client";
import {SIGDEC_VERSION_LABEL} from "../lib/release";
import Link from "next/link";
import {useRealtimeRefresh} from "../lib/use-realtime-refresh";
import {useCallback,useEffect,useState} from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Feature={code:string;label:string;enabled:boolean;updatedAt?:string|null};

export default function AdministrationPage(){
 const[features,setFeatures]=useState<Feature[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const request=useCallback(async(path:string,init?:RequestInit)=>{const r=await fetch(API+path,{credentials:"include",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});if(r.status===401){location.href="/login";return null}const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message??b.error??"Falha na operação.");return b},[]);
 const load=useCallback(async()=>{try{const f=await request("/api/v1/admin/features");if(f)setFeatures(f.items??[])}catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar administração.")}},[request]);
 useEffect(()=>{void load()},[load]);useRealtimeRefresh(()=>{if(!busy)return load()},true,15000);
 async function toggleFeature(item:Feature){setBusy(true);setMessage("");try{await request("/api/v1/admin/features/"+item.code,{method:"PUT",body:JSON.stringify({enabled:!item.enabled})});setMessage(item.label+": "+(!item.enabled?"ativado":"desativado")+".");await load()}catch(e){setMessage(e instanceof Error?e.message:"Falha.")}finally{setBusy(false)}}
 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">SIGDEC · ADMINISTRAÇÃO · {SIGDEC_VERSION_LABEL}</span><h1>Administração do sistema</h1><p>Governança, usuários, cadastros, integrações, auditoria, saúde e prontidão institucional.</p></div><Link className="secondaryLink" href="/painel">Painel</Link></header>
  {message&&<section className="infoCard">{message}</section>}
  <section className="infoCard"><strong>Administração centralizada</strong><p>Use as abas acima para usuários, cadastros, integrações, auditoria, saúde, base legal e apresentação. Esta página mantém somente controles gerais do sistema.</p></section>\n  <section><h2>Módulos ativos</h2><p>O bloqueio é aplicado também na API; desativar um módulo não apaga dados.</p><div className="dataGrid">{features.map(x=><article className={x.enabled?"card":"warningCard"} key={x.code}><h2>{x.label}</h2><p><strong>{x.enabled?"Ativo":"Desativado"}</strong> · {x.code}</p><button type="button" className={x.enabled?"secondaryLink":"primaryButton"} disabled={busy} onClick={()=>void toggleFeature(x)}>{x.enabled?"Desativar":"Ativar"}</button></article>)}</div></section>
 </main>;
}
