"use client";
import {SIGDEC_VERSION_LABEL} from "../lib/release";
import { formatDateBR } from "../lib/datetime";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";
type SessionUser={id:string;matricula:string;displayName:string;email:string|null;jobTitle:string|null;department:string|null;roles:string[];permissions:string[];mustChangePassword:boolean;mfaRequired:boolean;mfaEnabled:boolean};

const nav: Array<[string,string,Route,string?]> =[
["⌂","Início","/painel"],["⚠","Ocorrências","/ocorrencias","incidents"],["◉","Riscos e Mapas","/campo","field"],["▲","Alertas","/monitoramento","monitoring"],
["♥","Assistência Humanitária","/assistencia","humanitarian"],["⌂","Abrigos","/assistencia#abrigos" as Route,"humanitarian"],["♟","Famílias","/assistencia#familias" as Route,"humanitarian"],["◇","Doações e Estoque","/assistencia#estoque" as Route,"humanitarian"],
["♥","Voluntariado","/voluntarios","volunteers"],["▥","Centro de Gestão","/gestao"],["▤","Documentos","/documentos","documents"],["⚙","Administração","/administracao"]
];
const quick: Array<[string,string,Route,string,string?]> =[["🚨","Registrar Ocorrência","/ocorrencias/nova","red","incidents"],["♟","Cadastrar Família","/assistencia#familias" as Route,"blue","humanitarian"],["⌂","Cadastrar Abrigo","/assistencia#abrigos" as Route,"green","humanitarian"],["◇","Registrar Entrega","/assistencia#entregas" as Route,"orange","humanitarian"],["▥","Centro de Gestão","/gestao","gray"]];
type DashboardIncident={id:string;summary:string;neighborhood:string|null;status:string;priority:string};
type MapIncident={id:string;protocol:string;status:string;priority:string;summary:string;neighborhood:string|null;latitude:number|null;longitude:number|null};
type DashboardSummary={activeIncidents:number;incidents24h:number;activeHouseholds:number;stockBalance:number;activeVolunteers:number;upcomingTrainings:number};
type Feature={code:string;enabled:boolean};
type CustomNavigation={id:string;label:string;path:string;sortOrder:number};

export default function PainelPage(){
 const [user,setUser]=useState<SessionUser|null>(null);const [incidents,setIncidents]=useState<DashboardIncident[]>([]);
 const [summary,setSummary]=useState<DashboardSummary|null>(null);const [features,setFeatures]=useState<Record<string,boolean>>({});
 const [customNavigation,setCustomNavigation]=useState<CustomNavigation[]>([]);const [mapIncidents,setMapIncidents]=useState<MapIncident[]>([]);const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
 useEffect(()=>{
  fetch(`${API_URL}/auth/me`,{credentials:"include"}).then(async r=>{if(!r.ok)throw 0;return r.json()}).then(b=>setUser(b.user)).catch(()=>location.href="/login");
  fetch(`${API_URL}/api/v1/incidents?limit=5`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>b&&setIncidents(b.items??[])).catch(()=>{});
  fetch(`${API_URL}/api/v1/dashboard/summary`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>b&&setSummary(b)).catch(()=>{});
  fetch(`${API_URL}/api/v1/features`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>{if(b)setFeatures(Object.fromEntries((b.items??[]).map((x:Feature)=>[x.code,x.enabled]))) }).catch(()=>{});
  fetch(`${API_URL}/api/v1/navigation`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>b&&setCustomNavigation(b.items??[])).catch(()=>{});
  fetch(`${API_URL}/api/v1/field/map`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>{if(b)setMapIncidents((b.incidents??[]).filter((x:MapIncident)=>x.latitude!==null&&x.longitude!==null&&Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude))))}).catch(()=>{});
 },[]);
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
 const googleSatelliteUrl="https://maps.google.com/maps?ll=-23.4332,-45.0834&z=10&t=k&output=embed";
 const mapBounds={north:-23.18,south:-23.68,west:-45.38,east:-44.68};
 const pinPosition=(x:MapIncident)=>{const lat=Number(x.latitude),lon=Number(x.longitude);const left=Math.max(2,Math.min(98,((lon-mapBounds.west)/(mapBounds.east-mapBounds.west))*100));const top=Math.max(2,Math.min(98,((mapBounds.north-lat)/(mapBounds.north-mapBounds.south))*100));return {left:`${left}%`,top:`${top}%`}};
 const handleSideInteraction=(event:MouseEvent<HTMLElement>)=>{if(typeof window==="undefined"||!window.matchMedia("(max-width: 800px)").matches||mobileMenuOpen)return;const target=event.target as HTMLElement;if(!target.closest("a,button"))return;event.preventDefault();event.stopPropagation();setMobileMenuOpen(true)};
 return <main className="opsDashboard">
  <aside className={`opsSide ${mobileMenuOpen?"mobileOpen":""}`} onClickCapture={handleSideInteraction}>
   <div className="opsSideBrand"><span className="opsCompactMark" aria-hidden="true">DC</span><div className="opsSideBrandText"><b>SIGDEC</b><small>Defesa Civil · Ubatuba</small></div><button type="button" className="opsMenuClose" aria-label="Recolher menu" onClick={()=>setMobileMenuOpen(false)}>×</button></div>
   <nav>{nav.filter(([, ,h,feature])=>featureOn(feature)&&(h!=="/administracao"||user.permissions.includes("admin.features")||user.permissions.includes("integrations.manage")||user.permissions.includes("system.master"))).map(([i,n,h],x)=><Link key={n} href={h} className={x===0?"active":""} title={n}><span className="opsMenuIcon">{i}</span><span className="opsMenuLabel">{n}</span></Link>)}{user.permissions.includes("system.master")&&<Link href="/administracao/usuarios" title="Usuários"><span className="opsMenuIcon">♙</span><span className="opsMenuLabel">Usuários</span></Link>}{(user.permissions.includes("audit.read")||user.permissions.includes("system.master"))&&<Link href="/administracao/auditoria" title="Registro de Atividades"><span className="opsMenuIcon">☷</span><span className="opsMenuLabel">Auditoria</span></Link>}{user.permissions.includes("system.master")&&<Link href="/administracao/saude" title="Saúde do Sistema"><span className="opsMenuIcon">◉</span><span className="opsMenuLabel">Saúde do Sistema</span></Link>}{customNavigation.map(item=><Link key={item.id} href={item.path as Route} title={item.label}><span className="opsMenuIcon">›</span><span className="opsMenuLabel">{item.label}</span></Link>)}</nav>
   <div className="opsUser"><span className="opsUserIcon" aria-hidden="true">●</span><div className="opsUserText"><b>{user.matricula}</b><small>{user.roles?.[0]||"Master"}</small></div></div>
   <button className="opsLogout" onClick={logout} title="Sair"><span className="opsMenuIcon">↪</span><span className="opsMenuLabel">Sair</span></button>
  </aside>
  <section className="opsMain">
   <header className="opsHero">
    <div className="opsMunicipal"><img className="officialCrest" src="https://www.ubatuba.sp.gov.br/wp-content/uploads/sites/2/2015/02/brasao.png" alt="Brasão oficial do Município de Ubatuba"/><div><strong>PREFEITURA DE<br/>UBATUBA</strong><small>CAPITAL DO SURF<br/>NATUREZA O ANO TODO</small></div></div>
    <div className="opsTitle"><b>SIGDEC</b><strong>Sistema Integrado de Gestão<br/>de Defesa Civil</strong><span>UBATUBA - SP</span></div>
    <div className="opsScenery"><span>Ubatuba</span><small>Nossa gente. Nossa natureza.<br/>Mais segura sempre.</small></div>
    <div className="dcBadge"><b>COORDENAÇÃO MUNICIPAL - SP</b><span>▲</span><strong>DEFESA CIVIL</strong></div>
   </header>
   <div className="opsContent">
    <div className="opsWelcome"><div><h1>Bem-vindo ao SIGDEC, {user.displayName.split(" ")[0]}!</h1><p>Aqui a informação se transforma em proteção para a nossa comunidade.</p></div><div className="opsDate">{formatDateBR(new Date())}<br/><small>Ubatuba - SP</small></div></div>
    <div className="opsStats">{stats.map(([v,l,d,c])=><article className={"stat "+c} key={l}><b>{v}</b><span>{l}</span><small>{d}</small></article>)}</div>
    <div className="opsQuick">{quick.filter(([, , , ,feature])=>featureOn(feature)).map(([i,n,h,c])=><Link href={h} className={"quick "+c} key={n}><b>{i}</b><span>{n}</span></Link>)}</div>
    <div className="opsBottom">
     <section className="opsCard"><header><h2>Ocorrências Recentes</h2><Link href="/ocorrencias">Ver todas</Link></header>{incidents.length===0?<p className="emptyMini">Nenhuma ocorrência recente.</p>:incidents.map((x,i)=><Link href={`/ocorrencias/${x.id}`} className="incidentMini" key={x.id}><i className={"dot d"+i}/><div><b>{x.summary}</b><small>⌖ {x.neighborhood??"Local não informado"} · {x.priority}</small></div><span>{x.status}</span></Link>)}</section>
     <section className="opsCard"><header><h2>Mapa de Situação</h2><Link href="/campo">Ver mapa completo</Link></header><div className="situationMap googleSituationMap"><iframe src={googleSatelliteUrl} title="Mapa de Situação — imagem de satélite do Google Maps" loading="lazy" referrerPolicy="no-referrer-when-downgrade"/>{locatedMapIncidents.map(x=><Link href={`/ocorrencias/${x.id}`} key={"map-"+x.id} className={`mapIncidentPin priorityMap-${x.priority}`} style={pinPosition(x)} title={`${x.protocol} · ${x.summary} · ${x.neighborhood??"localização georreferenciada"}`}><span>!</span></Link>)}<div className="mapSource">Google Maps · Satélite</div><div className="legend"><strong>{locatedMapIncidents.length}</strong> ocorrência(s) em aberto georreferenciada(s)<br/>🔴 Ocorrência em aberto</div></div></section>
    </div>
   </div>
   <footer className="opsFooter"><span>SIGDEC {SIGDEC_VERSION_LABEL} · Prefeitura da Cidade de Ubatuba - SP | Defesa Civil</span><b>Prevenir é preservar vidas.</b><span>Ubatuba mais segura, hoje e sempre.</span></footer>
  </section>
 </main>
}
