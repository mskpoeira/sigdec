"use client";

import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Summary={
 openRequests:number;missingRequirements:number;trainingDue:number;activeAgreements:number;
 activeSeasonalOperations:number;openExercises:number;openImprovements:number;
};

export default function ResilienciaPage(){
 const[data,setData]=useState<Summary|null>(null);
 const[message,setMessage]=useState("Carregando indicadores...");
 const load=useCallback(async()=>{
  try{
   const r=await fetch(API+"/api/v1/resilience/summary",{credentials:"include",cache:"no-store"});
   if(r.status===401){location.href="/login";return}
   const body=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(body.message??body.error??"Falha ao carregar.");
   setData(body);setMessage("");
  }catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar.");}
 },[]);
 useEffect(()=>{void load()},[load]);

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · RESILIÊNCIA E INTEGRAÇÃO · {SIGDEC_VERSION_LABEL}</span><h1>Centro de Resiliência</h1>
    <p>Solicitações estaduais/federais, capacitação, ajuda mútua, operações sazonais, simulados e melhoria contínua.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/planejamento">Planejamento</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}
  {data&&<section className="dataGrid">
   <article className={(data.openRequests>0||data.missingRequirements>0)?"warningCard":"card"}><h2>Apoios e recursos</h2><p className="adminNumber">{data.openRequests}</p><p>{data.missingRequirements} requisito(s) pendente(s)</p><Link className="secondaryLink" href="/apoios">Abrir solicitações</Link></article>
   <article className={data.trainingDue>0?"warningCard":"card"}><h2>Capacitação</h2><p className="adminNumber">{data.trainingDue}</p><p>certificado(s) vencido(s) ou vencendo em 30 dias</p><Link className="secondaryLink" href="/capacitacao">Abrir capacitação</Link></article>
   <article className="card"><h2>Ajuda mútua</h2><p className="adminNumber">{data.activeAgreements}</p><p>acordo(s) ativo(s)</p><Link className="secondaryLink" href="/ajuda-mutua">Abrir rede de apoio</Link></article>
   <article className="card"><h2>Operações sazonais</h2><p className="adminNumber">{data.activeSeasonalOperations}</p><p>operação(ões) ativa(s)</p><Link className="secondaryLink" href="/operacoes-sazonais">Abrir operações</Link></article>
   <article className={(data.openExercises>0||data.openImprovements>0)?"warningCard":"card"}><h2>Simulados e AAR/IP</h2><p className="adminNumber">{data.openExercises}</p><p>{data.openImprovements} ação(ões) de melhoria aberta(s)</p><Link className="secondaryLink" href="/simulados">Abrir exercícios</Link></article>
  </section>}

  <section className="infoCard" style={{marginTop:18}}>
   <strong>Arquitetura do módulo</strong>
   <p>Os fluxos externos são controlados pelo SIGDEC, mas só são marcados como protocolados/enviados quando o usuário registra um protocolo real. O sistema não simula integração automática com SIDEC, S2ID ou outros portais oficiais.</p>
  </section>
 </main>;
}
