"use client";

import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {formatDateTimeBR} from "../../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Check={code:string;label:string;ok:boolean;critical:boolean;link:string};
type Readiness={
 status:"READY"|"ATTENTION"|"BLOCKED";generatedAt:string;
 metrics:{activeUsers:number;activeMasters:number;incidentTypes:number;teams:number;vehicles:number;humanitarianItems:number;shelters:number;monitoringStations:number;communicationAssets:number;approvedPlancon:number;integrations:number;auditTotal:number;auditInvalid:number;auditUnsealed:number};
 migration:{filename:string;appliedAt:string}|null;
 checks:Check[];
 architecture:{jsonApis:boolean;postgis:boolean;auditAppendOnly:boolean;ed25519Checkpoints:boolean;offlineFieldSupport:boolean};
};

const statusText={READY:"Pronto para apresentação",ATTENTION:"Pronto com recomendações",BLOCKED:"Atenção necessária"};

export default function PresentationReadinessPage(){
 const[data,setData]=useState<Readiness|null>(null),[message,setMessage]=useState("");
 const load=useCallback(async()=>{
  try{
   const r=await fetch(API+"/api/v1/admin/presentation-readiness",{credentials:"include",cache:"no-store"});
   if(r.status===401){location.href="/login";return}
   const body=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(body.message??body.error??"Falha ao executar diagnóstico.");
   setData(body);setMessage("");
  }catch(e){setMessage(e instanceof Error?e.message:"Falha ao executar diagnóstico.");}
 },[]);
 useEffect(()=>{void load()},[load]);

 async function downloadJson(){
  if(!data)return;
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="sigdec-prontidao-apresentacao-"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · ADMINISTRAÇÃO · APRESENTAÇÃO · {SIGDEC_VERSION_LABEL}</span><h1>Prontidão para Apresentação Formal</h1>
    <p>Diagnóstico dos cadastros, integridade, infraestrutura e dados mínimos para demonstrações institucionais.</p></div>
   <div className="headerActions"><Link className="primaryButton" href="/apresentacao">▶ Modo institucional</Link><button type="button" className="secondaryLink" onClick={()=>void load()}>Executar novamente</button><button type="button" className="secondaryLink" disabled={!data} onClick={()=>void downloadJson()}>Baixar JSON</button><Link className="secondaryLink" href="/administracao">Administração</Link></div>
  </header>

  {message&&<section className="warningCard">{message}</section>}
  {data&&<>
   <section className={data.status==="BLOCKED"?"warningCard":"infoCard"}>
    <h2>{data.status==="READY"?"✓":data.status==="ATTENTION"?"⚠":"✕"} {statusText[data.status]}</h2>
    <p>Diagnóstico gerado em {formatDateTimeBR(data.generatedAt)}{data.migration?" · última migração "+data.migration.filename:""}</p>
   </section>

   <section className="dataGrid" style={{marginTop:16}}>
    <article className="card"><h2>Usuários ativos</h2><p className="adminNumber">{data.metrics.activeUsers}</p><p>{data.metrics.activeMasters} Master ativo(s)</p></article>
    <article className="card"><h2>Equipes / Viaturas</h2><p className="adminNumber">{data.metrics.teams} / {data.metrics.vehicles}</p><p>recursos operacionais cadastrados</p></article>
    <article className="card"><h2>Tipos de ocorrência</h2><p className="adminNumber">{data.metrics.incidentTypes}</p><p>tipificações disponíveis</p></article>
    <article className="card"><h2>Itens humanitários</h2><p className="adminNumber">{data.metrics.humanitarianItems}</p><p>itens ativos</p></article>
    <article className="card"><h2>Monitoramento</h2><p className="adminNumber">{data.metrics.monitoringStations}</p><p>estações ativas</p></article>
    <article className="card"><h2>Comunicações</h2><p className="adminNumber">{data.metrics.communicationAssets}</p><p>ativos cadastrados</p></article>
    <article className="card"><h2>PLANCON</h2><p className="adminNumber">{data.metrics.approvedPlancon}</p><p>aprovado(s)/ativo(s)</p></article>
    <article className={data.metrics.auditInvalid||data.metrics.auditUnsealed?"warningCard":"card"}><h2>Auditoria</h2><p className="adminNumber">{data.metrics.auditTotal}</p><p>{data.metrics.auditInvalid} inválido(s) · {data.metrics.auditUnsealed} sem selo</p></article>
   </section>

   <section style={{marginTop:22}}>
    <h2>Checklist de apresentação</h2>
    <div className="adminTableWrap"><table><thead><tr><th>Resultado</th><th>Verificação</th><th>Criticidade</th><th>Correção/Consulta</th></tr></thead>
     <tbody>{data.checks.map(x=><tr key={x.code}><td><strong>{x.ok?"✓ OK":"⚠ Pendente"}</strong></td><td>{x.label}</td><td>{x.critical?"Crítica":"Recomendada"}</td><td><Link className="secondaryLink" href={x.link}>Abrir</Link></td></tr>)}</tbody>
    </table></div>
   </section>

   <section className="dataGrid" style={{marginTop:22}}>
    <article className="card"><h2>APIs JSON</h2><p><strong>{data.architecture.jsonApis?"✓ Ativas":"—"}</strong></p><p>Interfaces orientadas a JSON e integração.</p></article>
    <article className="card"><h2>PostGIS</h2><p><strong>{data.architecture.postgis?"✓ Habilitado":"—"}</strong></p><p>Georreferenciamento e análise espacial.</p></article>
    <article className="card"><h2>Auditoria append-only</h2><p><strong>{data.architecture.auditAppendOnly?"✓ Habilitada":"—"}</strong></p><p>Rastreabilidade de alterações.</p></article>
    <article className="card"><h2>Ed25519</h2><p><strong>{data.architecture.ed25519Checkpoints?"✓ Habilitado":"—"}</strong></p><p>Checkpoints verificáveis de auditoria.</p></article>
    <article className="card"><h2>Campo / offline</h2><p><strong>{data.architecture.offlineFieldSupport?"✓ Preparado":"—"}</strong></p><p>Fluxos de campo e captura operacional.</p></article>
   </section>
  </>}
 </main>;
}
