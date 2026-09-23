"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
export default function Page(){const [items,setItems]=useState<any[]>([]);const [status,setStatus]=useState("Carregando...");
useEffect(()=>{fetch(`${API}/api/v1/monitoring/stations`,{credentials:"include"}).then(async r=>{if(r.status===401){location.href="/login";return null}if(!r.ok)throw new Error();return r.json()}).then(b=>{if(b){setItems(b.items??[]);setStatus("")}}).catch(()=>setStatus("Não foi possível carregar os dados."))},[]);
return <main className="shell moduleShell"><header className="listHeader"><div><span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span><h1>Monitoramento</h1><p>Pluviômetros, estações e pontos monitorados.</p></div><div className="headerActions"><Link className="secondaryLink" href="/painel">Painel</Link></div></header>
{status&&<section className="infoCard">{status}</section>}<section className="dataGrid">{items.length===0&&!status?<div className="infoCard">Nenhum registro cadastrado.</div>:items.map((x:any)=><article className="card" key={x.id}><h2>{x.name}</h2><p><strong>{x.code}</strong> · {x.stationType}</p><p>{x.provider??"Fonte não informada"}{x.externalId?` · ID ${x.externalId}`:""}</p></article>)}</section></main>}