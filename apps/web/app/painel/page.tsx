"use client";
import {SIGDEC_VERSION_LABEL} from "../lib/release";
import { formatDateBR } from "../lib/datetime";
import {ptBR} from "../lib/pt-br";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import {useRealtimeRefresh} from "../lib/use-realtime-refresh";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";
type SessionUser={id:string;matricula:string;displayName:string;warName:string|null;email:string|null;jobTitle:string|null;department:string|null;roles:string[];permissions:string[];mustChangePassword:boolean;mfaRequired:boolean;mfaEnabled:boolean};

const quick: Array<[string,string,Route,string,string?]> =[["🚨","Registrar Ocorrência","/ocorrencias/nova","red","incidents"],["♟","Cadastrar Família","/assistencia#familias" as Route,"blue","humanitarian"],["⌂","Cadastrar Abrigo","/assistencia#abrigos" as Route,"green","humanitarian"],["◇","Registrar Entrega","/assistencia#entregas" as Route,"orange","humanitarian"],["▦","Operação PLANCON","/planejamento/operacao","purple"],["△","Gestão do Risco","/gestao-riscos","green","risks"],["✦","Inteligência SIGDEC","/inteligencia","navy"],["◆","Apoios Estado/União","/apoios","blue"],["▥","Centro de Gestão","/gestao","gray"],["▶","Apresentar SIGDEC","/apresentacao","navy"]];
type DashboardIncident={id:string;summary:string;neighborhood:string|null;status:string;priority:string};
type MapIncident={id:string;protocol:string;status:string;priority:string;summary:string;addressLine:string|null;neighborhood:string|null;latitude:number|null;longitude:number|null};
type DashboardSummary={activeIncidents:number;incidents24h:number;activeHouseholds:number;stockBalance:number;activeVolunteers:number;upcomingTrainings:number};
type Feature={code:string;enabled:boolean};

export default function PainelPage(){
 const [user,setUser]=useState<SessionUser|null>(null);const [incidents,setIncidents]=useState<DashboardIncident[]>([]);
 const [summary,setSummary]=useState<DashboardSummary|null>(null);const [features,setFeatures]=useState<Record<string,boolean>>({});
 const [mapIncidents,setMapIncidents]=useState<MapIncident[]>([]);
 const loadLive=useCallback(()=>{
  const parseCoordinate=(value:unknown)=>{
    if(value===null||value===undefined)return null;
    const parsed=Number(String(value).replace(",","."));
    return Number.isFinite(parsed)?parsed:null;
  };
  fetch(`${API_URL}/api/v1/incidents?limit=5`,{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setIncidents(b.items??[])).catch(()=>{});
  fetch(`${API_URL}/api/v1/dashboard/summary`,{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setSummary(b)).catch(()=>{});
  fetch(`${API_URL}/api/v1/field/map`,{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>{
    if(!b)return;
    const normalized=(b.incidents??[]).map((x:MapIncident)=>({...x,latitude:parseCoordinate(x.latitude),longitude:parseCoordinate(x.longitude)}));
    setMapIncidents(normalized);
  }).catch(()=>{});
 },[]);
 useEffect(()=>{
  fetch(`${API_URL}/auth/me`,{credentials:"include"}).then(async r=>{if(!r.ok)throw 0;return r.json()}).then(b=>setUser(b.user)).catch(()=>location.href="/login");
  fetch(`${API_URL}/api/v1/features`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>{if(b)setFeatures(Object.fromEntries((b.items??[]).map((x:Feature)=>[x.code,x.enabled]))) }).catch(()=>{});
  loadLive();
 },[loadLive]);
 useRealtimeRefresh(loadLive,true,250);
 async function logout(){await fetch(`${API_URL}/auth/logout`,{method:"POST",credentials:"include"});location.href="/login"}
 if(!user)return <main className="shell"><p>Carregando sessão...</p></main>;
 const stats:Array<[string,string,string,string]>=[
  [String(summary?.activeIncidents??"—"),"Ocorrências Ativas",summary?`${summary.incidents24h} registrada(s) nas últimas 24h`:"Carregando...","red"],
  [String(summary?.activeHouseholds??"—"),"Famílias Acompanhadas","Desalojadas/desabrigadas ativas","blue"],
  [summary?Number(summary.stockBalance).toLocaleString("pt-BR",{maximumFractionDigits:2}):"—","Saldo de Itens","Movimentação humanitária consolidada","green"],
  [String(summary?.activeVolunteers??"—"),"Voluntários Ativos","Cadastro operacional vigente","orange"],
  [String(summary?.upcomingTrainings??"—"),"Treinamentos Futuros","Programações ainda não iniciadas","purple"]
 ];
 const featureOn=(code?:string)=>!code||features[code]!==false;
 const locatedMapIncidents=mapIncidents.filter(x=>x.latitude!==null&&x.longitude!==null);
 const unlocatedMapIncidents=mapIncidents.length-locatedMapIncidents.length;
 const mapBounds={north:-23.18,south:-23.68,west:-45.38,east:-44.68};
 const mapZoom=11,mapTileSize=256,mapWorldSize=mapTileSize*(2**mapZoom);
 const worldPoint=(latitude:number,longitude:number)=>{
  const lat=Math.max(-85.05112878,Math.min(85.05112878,latitude))*Math.PI/180;
  return {x:((longitude+180)/360)*mapWorldSize,y:(1-Math.asinh(Math.tan(lat))/Math.PI)/2*mapWorldSize};
 };
 const mapNorthWest=worldPoint(mapBounds.north,mapBounds.west),mapSouthEast=worldPoint(mapBounds.south,mapBounds.east);
 const mapPixelWidth=mapSouthEast.x-mapNorthWest.x,mapPixelHeight=mapSouthEast.y-mapNorthWest.y;
 const osmTiles:Array<{key:string;src:string;style:{left:string;top:string;width:string;height:string}}>= [];
 for(let tileX=Math.floor(mapNorthWest.x/mapTileSize);tileX<=Math.floor(mapSouthEast.x/mapTileSize);tileX++){
  for(let tileY=Math.floor(mapNorthWest.y/mapTileSize);tileY<=Math.floor(mapSouthEast.y/mapTileSize);tileY++){
   osmTiles.push({key:`${tileX}-${tileY}`,src:`https://tile.openstreetmap.org/${mapZoom}/${tileX}/${tileY}.png`,style:{
    left:`${((tileX*mapTileSize-mapNorthWest.x)/mapPixelWidth)*100}%`,top:`${((tileY*mapTileSize-mapNorthWest.y)/mapPixelHeight)*100}%`,
    width:`${(mapTileSize/mapPixelWidth)*100}%`,height:`${(mapTileSize/mapPixelHeight)*100}%`
   }});
  }
 }
 const pinPosition=(incident:MapIncident)=>{const p=worldPoint(Number(incident.latitude),Number(incident.longitude));const left=Math.max(1.5,Math.min(98.5,((p.x-mapNorthWest.x)/mapPixelWidth)*100));const top=Math.max(1.5,Math.min(98.5,((p.y-mapNorthWest.y)/mapPixelHeight)*100));return {left:`${left}%`,top:`${top}%`}};
 return <main className="opsDashboard">
  <section className="opsMain">
   <header className="opsHero opsHeroOfficial" aria-label="Identidade institucional do SIGDEC">
    <img className="opsHeroOfficialBanner" src="/branding/sigdec-header-ubatuba.webp" alt="SIGDEC — Sistema Integrado de Gestão de Defesa Civil da Prefeitura de Ubatuba"/>
   </header>
   <div className="opsContent">
    <div className="opsWelcome"><div><h1>Bem-vindo ao SIGDEC, {user.warName?.trim()||user.displayName.split(" ")[0]}!</h1><p>Aqui a informação se transforma em proteção para a nossa comunidade.</p></div><div className="opsDate">{formatDateBR(new Date())}<br/><small>Ubatuba - SP</small></div></div>
    <div className="opsStats">{stats.map(([v,l,d,c])=><article className={"stat "+c} key={l}><b>{v}</b><span>{l}</span><small>{d}</small></article>)}</div>
    <div className="opsQuick">{quick.filter(([, , , ,feature])=>featureOn(feature)).map(([i,n,h,c])=><Link href={h} className={"quick "+c} key={n}><b>{i}</b><span>{n}</span></Link>)}</div>
    <div className="opsBottom">
     <section className="opsCard"><header><h2>Ocorrências Recentes</h2><Link href="/ocorrencias">Ver todas</Link></header>{incidents.length===0?<p className="emptyMini">Nenhuma ocorrência recente.</p>:incidents.map((x,i)=><Link href={`/ocorrencias/${x.id}`} className="incidentMini" key={x.id}><i className={"dot d"+i}/><div><b>{x.summary}</b><small>⌖ {x.neighborhood??"Local não informado"} · {ptBR(x.priority)}</small></div><span>{ptBR(x.status)}</span></Link>)}</section>
     <section className="opsCard"><header><h2>Mapa de Situação <small className="liveBadge">● TEMPO REAL</small></h2><Link href="/campo?monitor=1" target="_blank">Abrir monitor em nova aba ↗</Link></header><div className="situationMap googleSituationMap">{osmTiles.map(tile=><img key={tile.key} className="osmSituationTile" src={tile.src} style={tile.style} alt="" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/>)}<a className="mapOpenRealtime" href="/campo?monitor=1" target="_blank" rel="noreferrer" aria-label="Abrir mapa de ocorrências em tempo real em nova aba"/>{locatedMapIncidents.map(x=><Link href={`/ocorrencias/${x.id}`} key={"map-"+x.id} className={`mapIncidentPin priorityMap-${x.priority}`} style={pinPosition(x)} title={`${x.protocol} · ${x.summary} · ${x.neighborhood??"localização georreferenciada"}`}><span>!</span></Link>)}<a className="mapSource" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap · atualização em tempo real</a><div className="legend"><strong>{locatedMapIncidents.length}</strong> ocorrência(s) em aberto no mapa{unlocatedMapIncidents>0&&<><br/><span className="mapPendingLocation">⚠ {unlocatedMapIncidents} sem coordenadas — localização pendente</span></>}<br/>🔴 Ocorrência em aberto</div></div></section>
    </div>
   </div>
   <footer className="opsFooter"><span>SIGDEC {SIGDEC_VERSION_LABEL} · Prefeitura da Cidade de Ubatuba - SP | Defesa Civil</span><b>Prevenir é preservar vidas.</b><span>Ubatuba mais segura, hoje e sempre.</span></footer>
  </section>
 </main>
}
