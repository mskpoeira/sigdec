"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";
type SessionUser={id:string;matricula:string;displayName:string;email:string|null;jobTitle:string|null;department:string|null;roles:string[];permissions:string[];mustChangePassword:boolean;mfaRequired:boolean;mfaEnabled:boolean};

const nav: Array<[string, string, Route]> =[
["⌂","Início","/painel"],["⚠","Ocorrências","/ocorrencias"],["◉","Riscos e Mapas","/campo"],["▲","Alertas","/monitoramento"],
["♥","Assistência Humanitária","/assistencia"],["⌂","Abrigos","/assistencia"],["♟","Famílias","/assistencia"],["◇","Doações e Estoque","/assistencia"],
["♥","Voluntariado","/voluntarios"],["♟","Treinamentos e Simulados","/gestao"],["♻","Recuperação","/gestao"],["▥","Relatórios e BI","/gestao"],
["↻","Integrações (S2iD)","/gestao"],["▤","Documentos","/documentos"],["⚙","Administração","/gestao"]
];
const stats: Array<[string,string,string,string]> =[["2","Ocorrências Ativas","+1 nas últimas 24h","red"],["12","Famílias em Abrigos","-3 desde ontem","blue"],["1.245","Itens em Estoque","+320 esta semana","green"],["18","Voluntários Ativos","+5 esta semana","orange"],["3","Treinamentos","Próximo em 5 dias","purple"]];
const quick: Array<[string, string, Route, string]> =[["🚨","Registrar Ocorrência","/ocorrencias/nova","red"],["♟","Cadastrar Família","/assistencia","blue"],["⌂","Gerenciar Abrigos","/assistencia","green"],["◇","Registrar Entrega","/assistencia","orange"],["▤","Planejar Treinamento","/gestao","navy"],["▥","Relatórios e Indicadores","/gestao","gray"]];
type DashboardIncident={id:string;summary:string;neighborhood:string|null;status:string;priority:string};

export default function PainelPage(){
 const [user,setUser]=useState<SessionUser|null>(null); const [incidents,setIncidents]=useState<DashboardIncident[]>([]);
 useEffect(()=>{fetch(`${API_URL}/auth/me`,{credentials:"include"}).then(async r=>{if(!r.ok)throw 0;return r.json()}).then(b=>setUser(b.user)).catch(()=>location.href="/login");fetch(`${API_URL}/api/v1/incidents?limit=5`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(b=>b&&setIncidents(b.items??[])).catch(()=>{})},[]);
 async function logout(){await fetch(`${API_URL}/auth/logout`,{method:"POST",credentials:"include"});location.href="/login"}
 if(!user)return <main className="shell"><p>Carregando sessão...</p></main>;
 return <main className="opsDashboard">
  <aside className="opsSide">
   <div className="opsSideBrand"><b>SIGDEC</b><small>Defesa Civil · Ubatuba</small></div>
   <nav>{nav.map(([i,n,h],x)=><Link key={n} href={h} className={x===0?"active":""}><span>{i}</span>{n}</Link>)}</nav>
   <div className="opsUser"><b>{user.matricula}</b><small>{user.roles?.[0]||"Master"}</small></div>
   <button onClick={logout}>↪ &nbsp; Sair</button>
  </aside>
  <section className="opsMain">
   <header className="opsHero">
    <div className="opsMunicipal"><img className="officialCrest" src="https://www.ubatuba.sp.gov.br/wp-content/uploads/sites/2/2015/02/brasao.png" alt="Brasão oficial do Município de Ubatuba"/><div><strong>PREFEITURA DE<br/>UBATUBA</strong><small>CAPITAL DO SURF<br/>NATUREZA O ANO TODO</small></div></div>
    <div className="opsTitle"><b>SIGDEC</b><strong>Sistema Integrado de Gestão<br/>de Desastres e Emergências</strong><span>UBATUBA - SP</span></div>
    <div className="opsScenery"><span>Ubatuba</span><small>Nossa gente. Nossa natureza.<br/>Mais segura sempre.</small></div>
    <div className="dcBadge"><b>COORDENAÇÃO MUNICIPAL - SP</b><span>▲</span><strong>DEFESA CIVIL</strong></div>
   </header>
   <div className="opsContent">
    <div className="opsWelcome"><div><h1>Bem-vindo ao SIGDEC, {user.displayName.split(" ")[0]}!</h1><p>Aqui a informação se transforma em proteção para a nossa comunidade.</p></div><div className="opsDate">{new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}<br/><small>Ubatuba - SP</small></div></div>
    <div className="opsStats">{stats.map(([v,l,d,c])=><article className={"stat "+c} key={l}><b>{v}</b><span>{l}</span><small>{d}</small></article>)}</div>
    <div className="opsQuick">{quick.map(([i,n,h,c])=><Link href={h} className={"quick "+c} key={n}><b>{i}</b><span>{n}</span></Link>)}</div>
    <div className="opsBottom">
     <section className="opsCard"><header><h2>Ocorrências Recentes</h2><Link href="/ocorrencias">Ver todas</Link></header>{incidents.length===0?<p className="emptyMini">Nenhuma ocorrência recente.</p>:incidents.map((x,i)=><Link href={`/ocorrencias/${x.id}`} className="incidentMini" key={x.id}><i className={"dot d"+i}/><div><b>{x.summary}</b><small>⌖ {x.neighborhood??"Local não informado"} · {x.priority}</small></div><span>{x.status}</span></Link>)}</section>
     <section className="opsCard"><header><h2>Mapa de Situação</h2><Link href="/campo">Ver mapa completo</Link></header><div className="situationMap"><div className="coast">UBATUBA</div><i className="pin p1">!</i><i className="pin p2">▲</i><i className="pin p3">⌂</i><i className="pin p4">⌂</i><div className="legend">🔴 Ocorrência ativa<br/>🟡 Em monitoramento<br/>🟢 Resolvida<br/>🔵 Abrigo</div></div></section>
    </div>
   </div>
   <footer className="opsFooter"><span>SIGDEC v1.29.0 · Prefeitura da Cidade de Ubatuba - SP | Defesa Civil</span><b>Prevenir é preservar vidas.</b><span>Ubatuba mais segura, hoje e sempre.</span></footer>
  </section>
 </main>
}