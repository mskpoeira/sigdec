"use client";

import Link from "next/link";
import type {Route} from "next";
import {useCallback,useEffect,useMemo,useState} from "react";
import {formatDateTimeBR} from "../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Module={
 code:string;step:number;title:string;description:string;href:string;available:boolean;metrics:Array<[string,number|null]>;
};
type Overview={
 organization:string;generatedAt:string;user:{matricula:string;displayName:string};
 metrics:Record<string,number|null>;modules:Module[];
};

const metricText=(value:number|null)=>value===null?"—":Number(value).toLocaleString("pt-BR");
const lifecycle=["Prevenir","Monitorar","Responder","Coordenar","Assistir","Recuperar","Aprender"];

export default function InstitutionalPresentationPage(){
 const[data,setData]=useState<Overview|null>(null),[message,setMessage]=useState("Preparando apresentação institucional...");
 const[slide,setSlide]=useState(0);

 const load=useCallback(async()=>{
  try{
   const response=await fetch(API+"/api/v1/presentation/overview",{credentials:"include",cache:"no-store"});
   if(response.status===401){location.href="/login";return}
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.message??body.error??"Não foi possível preparar a apresentação.");
   setData(body);setMessage("");setSlide(0);
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar a apresentação.");}
 },[]);

 useEffect(()=>{void load()},[load]);

 const modules=useMemo(()=>data?.modules.filter(x=>x.available)??[],[data]);
 const totalSlides=modules.length+1;
 const current=slide===0?null:modules[slide-1]??null;

 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.key==="ArrowRight"||event.key==="PageDown"){event.preventDefault();setSlide(v=>Math.min(totalSlides-1,v+1))}
   if(event.key==="ArrowLeft"||event.key==="PageUp"){event.preventDefault();setSlide(v=>Math.max(0,v-1))}
   if(event.key==="Home"){event.preventDefault();setSlide(0)}
   if(event.key==="End"){event.preventDefault();setSlide(Math.max(0,totalSlides-1))}
  };
  window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
 },[totalSlides]);

 async function fullscreen(){
  if(!document.fullscreenElement)await document.documentElement.requestFullscreen().catch(()=>{});
  else await document.exitFullscreen().catch(()=>{});
 }

 return <main className="presentationMode">
  <header className="presentationTopbar">
   <div className="presentationBrand"><span className="presentationMark">DC</span><div><strong>SIGDEC</strong><small>Sistema Integrado de Gestão de Defesa Civil</small></div></div>
   <div className="presentationActions"><button type="button" onClick={()=>void fullscreen()}>⛶ Tela cheia</button><button type="button" onClick={()=>void load()}>↻ Atualizar dados</button><Link href="/painel">Sair da apresentação</Link></div>
  </header>

  {message&&<section className="presentationLoading">{message}</section>}

  {data&&<section className="presentationViewport">
   {slide===0?<article className="presentationHeroSlide">
    <div className="presentationHeroCopy">
     <span className="presentationEyebrow">APRESENTAÇÃO INSTITUCIONAL · {SIGDEC_VERSION_LABEL}</span>
     <h1>Defesa Civil integrada do planejamento à recuperação.</h1>
     <p>Uma plataforma única para transformar informação, coordenação, rastreabilidade e resposta em proteção efetiva para a população.</p>
     <div className="presentationInstitution"><strong>{data.organization}</strong><span>Dados atualizados em {formatDateTimeBR(data.generatedAt)}</span></div>
    </div>
    <div className="presentationOverview">
     <div><strong>{metricText(data.metrics.activeIncidents)}</strong><span>ocorrências ativas</span></div>
     <div><strong>{metricText(data.metrics.availableTeams)}</strong><span>equipes disponíveis</span></div>
     <div><strong>{metricText(data.metrics.availableVehicles)}</strong><span>viaturas disponíveis</span></div>
     <div><strong>{metricText(data.metrics.activeHouseholds)}</strong><span>famílias acompanhadas</span></div>
    </div>
    <div className="presentationLifecycle">{lifecycle.map((x,i)=><span key={x}><b>{i+1}</b>{x}</span>)}</div>
    <div className="presentationPrinciples">
     <span>API-first e JSON</span><span>PostgreSQL + PostGIS</span><span>Auditoria e integridade</span><span>Operação de campo</span><span>SIDEC / S2ID</span><span>Governança municipal</span>
    </div>
   </article>:current&&<article className="presentationModuleSlide">
    <div className="presentationStep"><span>{String(current.step).padStart(2,"0")}</span><small>ETAPA OPERACIONAL</small></div>
    <div className="presentationModuleCopy">
     <span className="presentationEyebrow">SIGDEC · CICLO INTEGRADO</span>
     <h1>{current.title}</h1>
     <p>{current.description}</p>
     <div className="presentationMetrics">
      {current.metrics.map(([label,value])=><div key={label}><strong>{metricText(value)}</strong><span>{label}</span></div>)}
     </div>
     <div className="presentationModuleActions"><Link href={current.href as Route} target="_blank">Abrir módulo ao vivo ↗</Link><span>Os indicadores são agregados e não exibem dados pessoais nesta apresentação.</span></div>
    </div>
    <div className={"presentationModuleVisual visual-"+current.code}>
     <span className="presentationModuleIcon">{current.code==="monitoring"?"▲":current.code==="incidents"?"⚠":current.code==="operations"?"▥":current.code==="humanitarian"?"♥":current.code==="resilience"?"◆":"▤"}</span>
     <strong>{current.title}</strong>
     <small>Informação operacional · decisão · rastreabilidade</small>
    </div>
   </article>}

   <footer className="presentationControls">
    <div className="presentationProgress">{Array.from({length:totalSlides},(_,i)=><button key={i} type="button" className={i===slide?"active":""} aria-label={"Ir para slide "+(i+1)} onClick={()=>setSlide(i)}/>)}</div>
    <div className="presentationNav"><button type="button" disabled={slide===0} onClick={()=>setSlide(v=>Math.max(0,v-1))}>← Anterior</button><span>{slide+1} / {totalSlides}</span><button type="button" disabled={slide>=totalSlides-1} onClick={()=>setSlide(v=>Math.min(totalSlides-1,v+1))}>Próximo →</button></div>
    <div className="presentationPresenter"><small>Apresentado por</small><strong>{data.user.displayName}</strong><span>matrícula {data.user.matricula}</span></div>
   </footer>
  </section>}
 </main>;
}
