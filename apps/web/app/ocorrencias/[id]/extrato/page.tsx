"use client";
import { formatDateTimeBR } from "../../../lib/datetime";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback,useEffect,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Extract={
 generatedAt:string;
 incident:any;
 timeline:any[];
 dispatches:any[];
 inspections:any[];
 actions:any[];
 supportRequests:any[];
 humanitarianDeliveries:any[];
};

export default function ExtratoOcorrenciaPage(){
 const params=useParams<{id:string}>(),id=params.id;
 const [data,setData]=useState<Extract|null>(null),[message,setMessage]=useState("Carregando extrato...");

 const load=useCallback(async()=>{
  const response=await fetch(`${API}/api/v1/incidents/${id}/extract`,{credentials:"include"});
  if(response.status===401){location.href="/login";return}
  if(!response.ok)throw new Error("Não foi possível gerar o extrato da ocorrência.");
  setData(await response.json());setMessage("");
 },[id]);

 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar extrato."))},[load]);

 if(!data)return <main className="shell moduleShell"><section className="infoCard">{message}</section></main>;
 const i=data.incident;
 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">EXTRATO OPERACIONAL · {i.protocol}</span><h1>{i.summary}</h1><p>Registro consolidado do atendimento municipal de proteção e defesa civil.</p></div>
   <div className="headerActions"><button className="primaryButton" type="button" onClick={()=>window.print()}>Imprimir / salvar PDF</button><Link className="secondaryLink" href={`/ocorrencias/${id}`}>Voltar à ocorrência</Link></div>
  </header>

  <section className="detailGrid">
   <article className="card detailCard"><h2>Identificação</h2><dl className="detailList">
    <div><dt>Protocolo</dt><dd>{i.protocol}</dd></div><div><dt>Status</dt><dd>{i.status}</dd></div>
    <div><dt>Prioridade</dt><dd>{i.priority}</dd></div><div><dt>Tipo</dt><dd>{i.typeGroup} · {i.typeName}</dd></div>
    <div><dt>Risco à vida</dt><dd>{i.riskToLife?"Sim":"Não"}</dd></div><div><dt>Origem</dt><dd>{i.source}</dd></div>
    <div className="detailWide"><dt>Descrição</dt><dd>{i.description||"Sem descrição complementar."}</dd></div>
   </dl></article>
   <article className="card detailCard"><h2>Local e datas</h2><p>{[i.addressLine,i.neighborhood].filter(Boolean).join(" · ")||"Endereço não informado"}</p>{i.referencePoint&&<p>Referência: {i.referencePoint}</p>}<p>Aberta em {formatDateTimeBR(i.createdAt)}</p><p>Extrato gerado em {formatDateTimeBR(data.generatedAt)}</p></article>
  </section>

  <section className="detailSection"><div><span className="eyebrow">DESPACHOS</span><h2>Recursos empenhados</h2></div>{data.dispatches.length===0?<div className="infoCard">Nenhum despacho.</div>:<div className="dataGrid">{data.dispatches.map((x:any,idx)=><article className="card" key={idx}><h2>{x.teamCode} · {x.teamName}</h2><p>{x.vehicleCode||"Sem viatura"} · {x.status}</p><p>{formatDateTimeBR(x.dispatchedAt)}</p>{x.notes&&<p>{x.notes}</p>}</article>)}</div>}</section>

  <section className="detailSection"><div><span className="eyebrow">VISTORIAS</span><h2>Vistorias vinculadas</h2></div>{data.inspections.length===0?<div className="infoCard">Nenhuma vistoria vinculada.</div>:<div className="dataGrid">{data.inspections.map((x:any)=><article className="card" key={x.id}><h2>{x.inspectionType}</h2><p><strong>{x.status}</strong> · risco {x.riskLevel}</p><p>{x.addressLine}</p>{x.findings&&<p>{x.findings}</p>}{x.recommendations&&<p><strong>Recomendações:</strong> {x.recommendations}</p>}</article>)}</div>}</section>

  <section className="detailSection"><div><span className="eyebrow">AÇÕES DA COMPDEC</span><h2>Ações municipais registradas</h2></div>{data.actions.length===0?<div className="infoCard">Nenhuma ação municipal registrada.</div>:<div className="dataGrid">{data.actions.map((x:any)=><article className="card" key={x.id}><h2>{x.title}</h2><p><strong>{x.actionType}</strong> · {formatDateTimeBR(x.startedAt)}</p>{x.description&&<p>{x.description}</p>}<p>Participantes: {x.participantsCount}</p></article>)}</div>}</section>

  <section className="detailSection"><div><span className="eyebrow">SOLICITAÇÕES</span><h2>Solicitações operacionais</h2></div>{data.supportRequests.length===0?<div className="infoCard">Nenhuma solicitação operacional.</div>:<div className="dataGrid">{data.supportRequests.map((x:any)=><article className="card" key={x.id}><h2>{x.requestType}</h2><p><strong>{x.status}</strong>{x.destination?` · ${x.destination}`:""}</p><p>{x.justification}</p>{x.externalProtocol&&<p>Protocolo externo: {x.externalProtocol}</p>}{Array.isArray(x.requestedItems)&&x.requestedItems.length>0&&<ul>{x.requestedItems.map((item:any,idx:number)=><li key={idx}>{item.name}{item.quantity?` · ${item.quantity} ${item.unit??""}`:""}</li>)}</ul>}</article>)}</div>}</section>

  <section className="detailSection"><div><span className="eyebrow">ASSISTÊNCIA HUMANITÁRIA</span><h2>Entregas vinculadas</h2></div>{data.humanitarianDeliveries.length===0?<div className="infoCard">Nenhuma entrega vinculada.</div>:<div className="dataGrid">{data.humanitarianDeliveries.map((x:any,idx:number)=><article className="card" key={idx}><h2>{formatDateTimeBR(x.deliveredAt)}</h2><p>Destinatário: {x.recipientName}</p>{x.notes&&<p>{x.notes}</p>}{Array.isArray(x.items)&&x.items.length>0&&<ul>{x.items.map((item:any,j:number)=><li key={j}>{item.item} · {item.quantity} {item.unit}</li>)}</ul>}</article>)}</div>}</section>

  <section className="detailSection"><div><span className="eyebrow">HISTÓRICO</span><h2>Linha do tempo consolidada</h2></div><div className="timeline">{data.timeline.map((x:any,idx:number)=><article className="timelineItem" key={idx}><span className="timelineDot"/><div><strong>{x.eventType}</strong><p>{x.note||"Registro automático."}</p><small>{formatDateTimeBR(x.occurredAt)}{x.actorName?` · ${x.actorName}`:""}</small></div></article>)}</div></section>
 </main>
}