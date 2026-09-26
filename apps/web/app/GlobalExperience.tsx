"use client";

import type {Route} from "next";
import {usePathname,useRouter} from "next/navigation";
import {createPortal} from "react-dom";
import {useEffect,useMemo,useRef,useState} from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Result={
 kind:string;title:string;subtitle:string;meta?:string|null;href:string;status?:string|null;icon:string;
};

const publicPrefixes=["/login","/esqueci-senha","/redefinir-senha","/alterar-senha","/integridade","/verificar-integridade","/offline"];
const labels:Record<string,string>={
 painel:"Painel",ocorrencias:"Ocorrências",nova:"Nova ocorrência",extrato:"Extrato",sidec:"SIDEC",
 campo:"Riscos e Mapas",monitoramento:"Monitoramento",vistorias:"Vistorias",assistencia:"Assistência Humanitária",
 voluntarios:"Voluntariado",planejamento:"Planejamento e Contingência",operacao:"Operação PLANCON",gestao:"Centro de Gestão",
 sco:"SCO",comunicacoes:"Comunicações",resiliencia:"Resiliência",apoios:"Apoios Estado/União",capacitacao:"Capacitação",
 "ajuda-mutua":"Ajuda Mútua","operacoes-sazonais":"Operações Sazonais",simulados:"Simulados e AAR/IP",
 documentos:"Documentos",continuidade:"Continuidade",administracao:"Administração",usuarios:"Usuários",
 cadastros:"Cadastros Operacionais",auditoria:"Auditoria",saude:"Saúde do Sistema",apresentacao:"Apresentação"
};
const kindLabels:Record<string,string>={
 INCIDENT:"Ocorrência",HOUSEHOLD:"Família",SHELTER:"Abrigo",ITEM:"Item",VOLUNTEER:"Voluntário",TEAM:"Equipe",
 VEHICLE:"Viatura",DOCUMENT:"Documento",STATION:"Estação",PLANCON:"PLANCON",SUPPORT:"Apoio externo",USER:"Usuário"
};

function humanize(segment:string,index:number,parts:string[]){
 if(labels[segment])return labels[segment];
 if(index>0&&parts[index-1]==="ocorrencias")return "Detalhe da ocorrência";
 if(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment))return "Detalhe";
 return segment.replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

export default function GlobalExperience(){
 const pathname=usePathname(),router=useRouter();
 const[open,setOpen]=useState(false),[query,setQuery]=useState(""),[results,setResults]=useState<Result[]>([]);
 const[loading,setLoading]=useState(false),[selected,setSelected]=useState(0),[header,setHeader]=useState<Element|null>(null);
 const inputRef=useRef<HTMLInputElement|null>(null);
 const hidden=pathname==="/"||publicPrefixes.some(x=>pathname.startsWith(x));

 useEffect(()=>{
  if(hidden){setHeader(null);return}
  const raf=requestAnimationFrame(()=>setHeader(document.querySelector(".moduleShell > .listHeader:first-child")));
  return()=>cancelAnimationFrame(raf);
 },[pathname,hidden]);

 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){
    event.preventDefault();setOpen(value=>!value);return;
   }
   if(event.key==="Escape")setOpen(false);
  };
  window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
 },[]);

 useEffect(()=>{
  if(!open){setQuery("");setResults([]);setSelected(0);return}
  const timer=setTimeout(()=>inputRef.current?.focus(),30);return()=>clearTimeout(timer);
 },[open]);

 useEffect(()=>{
  if(!open||query.trim().length<2){setResults([]);setLoading(false);return}
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);
   try{
    const response=await fetch(API+"/api/v1/search?q="+encodeURIComponent(query.trim())+"&limit=40",{credentials:"include",cache:"no-store",signal:controller.signal});
    if(response.status===401){setOpen(false);return}
    const body=await response.json().catch(()=>({}));
    if(response.ok){setResults(body.items??[]);setSelected(0)}
   }catch(error){
    if(!(error instanceof DOMException&&error.name==="AbortError"))setResults([]);
   }finally{if(!controller.signal.aborted)setLoading(false)}
  },220);
  return()=>{clearTimeout(timer);controller.abort()};
 },[open,query]);

 const crumbs=useMemo(()=>{
  if(hidden||pathname==="/painel")return [];
  const parts=pathname.split("/").filter(Boolean);
  return [{label:"Painel",href:"/painel"},...parts.map((part,index)=>({
   label:humanize(part,index,parts),href:"/"+parts.slice(0,index+1).join("/")
  }))];
 },[pathname,hidden]);

 const go=(href:string)=>{setOpen(false);router.push(href as Route)};

 if(hidden)return null;

 const breadcrumb=header&&crumbs.length>0?createPortal(
  <nav className="contextBreadcrumb" aria-label="Navegação estrutural">
   {crumbs.map((item,index)=><span key={item.href}>
    {index>0&&<b aria-hidden="true">›</b>}
    {index===crumbs.length-1?<strong>{item.label}</strong>:<button type="button" onClick={()=>go(item.href)}>{item.label}</button>}
   </span>)}
  </nav>,header
 ):null;

 return <>
  {breadcrumb}
  <button type="button" className="globalSearchLauncher" onClick={()=>setOpen(true)} aria-label="Abrir busca global">
   <span aria-hidden="true">⌕</span><strong>Buscar no SIGDEC</strong><kbd>Ctrl K</kbd>
  </button>

  {open&&<div className="commandOverlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
   <section className="commandPalette" role="dialog" aria-modal="true" aria-label="Busca global do SIGDEC">
    <header className="commandHeader">
     <span aria-hidden="true">⌕</span>
     <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Protocolo, pessoa, abrigo, viatura, equipe, documento, PLANCON..." aria-label="Termo de busca"
      onKeyDown={event=>{
       if(event.key==="ArrowDown"){event.preventDefault();setSelected(v=>Math.min(results.length-1,v+1))}
       if(event.key==="ArrowUp"){event.preventDefault();setSelected(v=>Math.max(0,v-1))}
       if(event.key==="Enter"&&results[selected]){event.preventDefault();go(results[selected].href)}
      }}/>
     <button type="button" onClick={()=>setOpen(false)} aria-label="Fechar busca">×</button>
    </header>

    {query.trim().length<2?<div className="commandIntro">
     <div><kbd>Ctrl K</kbd><span>abre a busca em qualquer tela</span></div>
     <div><kbd>↑ ↓</kbd><span>navega pelos resultados</span></div>
     <div><kbd>Enter</kbd><span>abre o registro selecionado</span></div>
     <nav className="commandQuick" aria-label="Acessos rápidos">
      <button onClick={()=>go("/ocorrencias")}>⚠ Ocorrências</button>
      <button onClick={()=>go("/assistencia")}>♥ Assistência</button>
      <button onClick={()=>go("/planejamento")}>▦ Planejamento</button>
      <button onClick={()=>go("/resiliencia")}>◆ Resiliência</button>
      <button onClick={()=>go("/apresentacao")}>▶ Apresentar SIGDEC</button>
     </nav>
    </div>:loading?<div className="commandState"><span className="commandSpinner"/>Pesquisando em módulos autorizados...</div>
    :results.length===0?<div className="commandState">Nenhum registro encontrado para <strong>{query.trim()}</strong>.</div>
    :<div className="commandResults" role="listbox" aria-label="Resultados">
      {results.map((item,index)=><button type="button" role="option" aria-selected={index===selected} className={index===selected?"selected":""} key={item.kind+"-"+item.href+"-"+index} onMouseEnter={()=>setSelected(index)} onClick={()=>go(item.href)}>
       <span className="commandResultIcon" aria-hidden="true">{item.icon}</span>
       <span className="commandResultText"><strong>{item.title}</strong><small>{kindLabels[item.kind]??item.kind}{item.subtitle?" · "+item.subtitle:""}</small></span>
       <span className="commandResultMeta">{item.meta??item.status??""}</span>
      </button>)}
    </div>}
    <footer className="commandFooter"><span>Busca respeita as permissões do usuário e a organização ativa.</span><kbd>Esc</kbd></footer>
   </section>
  </div>}
 </>;
}
