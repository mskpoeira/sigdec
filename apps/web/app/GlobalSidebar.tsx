"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useMemo,useState} from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type User={matricula:string;displayName:string;warName:string|null;permissions:string[]};
type Feature={code:string;enabled:boolean};
type Item={icon:string;label:string;href:string;feature?:string;admin?:boolean};
type Group={icon:string;label:string;items:Item[]};

const direct:Item[]=[
 {icon:"⌂",label:"Início",href:"/painel"},
 {icon:"⚠",label:"Ocorrências",href:"/ocorrencias",feature:"incidents"},
 {icon:"◉",label:"Monitoramento Ambiental",href:"/monitoramento",feature:"monitoring"},
 {icon:"♥",label:"Assistência Humanitária",href:"/assistencia",feature:"humanitarian"},
 {icon:"◆",label:"Resiliência",href:"/resiliencia"},
 {icon:"☂",label:"Voluntariado",href:"/voluntarios",feature:"volunteers"},
 {icon:"☊",label:"Comunicações",href:"/comunicacoes",feature:"communications"}
];
const groups:Group[]=[
 {icon:"✦",label:"Inteligência SIGDEC",items:[
  {icon:"✦",label:"Inteligência e IA",href:"/inteligencia"},
  {icon:"▤",label:"Documentos",href:"/documentos",feature:"documents"}
 ]},
 {icon:"▥",label:"Centro de Gestão",items:[
  {icon:"▥",label:"Centro de Gestão",href:"/gestao"},
  {icon:"◎",label:"SCO / Sala de Emergência",href:"/sco",feature:"sco"}
 ]},
 {icon:"▦",label:"PLANCON e Gestão do Risco",items:[
  {icon:"▦",label:"Planejamento e Contingência",href:"/planejamento"},
  {icon:"▶",label:"Operação PLANCON",href:"/planejamento/operacao"},
  {icon:"△",label:"Gestão do Risco",href:"/gestao-riscos",feature:"risks"}
 ]},
 {icon:"⚙",label:"Administração",items:[
  {icon:"⚙",label:"Visão geral",href:"/administracao",admin:true},
  {icon:"♟",label:"Usuários",href:"/administracao/usuarios",admin:true},
  {icon:"▦",label:"Cadastros operacionais",href:"/administracao/cadastros",admin:true},
  {icon:"⇄",label:"Integrações",href:"/administracao/integracoes",admin:true},
  {icon:"☷",label:"Auditoria",href:"/administracao/auditoria",admin:true},
  {icon:"♡",label:"Saúde do Sistema",href:"/administracao/saude",admin:true},
  {icon:"§",label:"Base legal",href:"/administracao/base-legal",admin:true}
 ]}
];

export default function GlobalSidebar(){
 const pathname=usePathname();
 const[user,setUser]=useState<User|null>(null),[features,setFeatures]=useState<Record<string,boolean>>({});
 const[open,setOpen]=useState(false),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const hidden=pathname==="/"||["/login","/esqueci-senha","/redefinir-senha","/alterar-senha","/integridade","/verificar-integridade","/offline"].some(x=>pathname.startsWith(x));
 useEffect(()=>{
  if(hidden)return;
  document.body.classList.add("sigdec-has-global-sidebar");
  return()=>document.body.classList.remove("sigdec-has-global-sidebar");
 },[hidden]);
 useEffect(()=>{
  if(hidden)return;
  fetch(API+"/auth/me",{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setUser(b.user)).catch(()=>{});
  fetch(API+"/api/v1/features",{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setFeatures(Object.fromEntries((b.items??[]).map((x:Feature)=>[x.code,x.enabled])))).catch(()=>{});
 },[hidden]);
 useEffect(()=>setOpen(false),[pathname]);
 const canAdmin=!!user&&["admin.features","integrations.manage","system.master","audit.read","users.manage"].some(p=>user.permissions.includes(p));
 const visible=(item:Item)=>(!item.feature||features[item.feature]!==false)&&(!item.admin||canAdmin);
 const currentGroups=useMemo(()=>Object.fromEntries(groups.map(g=>[g.label,g.items.some(i=>pathname===i.href||pathname.startsWith(i.href+"/"))])),[pathname]);
 useEffect(()=>{setExpanded(prev=>({...prev,...currentGroups}))},[currentGroups]);
 async function logout(){await fetch(API+"/auth/logout",{method:"POST",credentials:"include"});location.href="/login"}
 if(hidden)return null;
 const navItem=(item:Item)=><Link key={item.href} href={item.href} className={(pathname===item.href||pathname.startsWith(item.href+"/"))?"active":""} onClick={()=>setOpen(false)}><span className="globalNavIcon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></Link>;
 return <>
  <button className="globalNavMobileButton" type="button" onClick={()=>setOpen(true)} aria-label="Abrir menu do SIGDEC">☰<small>Menu</small></button>
  {open&&<button className="globalNavBackdrop" type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
  <aside className={"sigdecGlobalSidebar "+(open?"mobileOpen":"")} aria-label="Navegação principal do SIGDEC">
   <header className="globalNavBrand">
    <img src="https://www.ubatuba.sp.gov.br/wp-content/uploads/sites/2/2015/02/brasao.png" alt="Brasão de Ubatuba"/>
    <div><strong>SIGDEC</strong><small>Defesa Civil · Ubatuba</small></div>
    <button type="button" onClick={()=>setOpen(false)} aria-label="Fechar menu">×</button>
   </header>
   <nav className="globalNavScroll">
    {direct.filter(visible).map(navItem)}
    {groups.map(group=>{
     const items=group.items.filter(visible);if(!items.length)return null;
     const isOpen=expanded[group.label]??currentGroups[group.label]??false;
     return <section className={"globalNavGroup "+(currentGroups[group.label]?"activeGroup":"")} key={group.label}>
      <button type="button" className="globalNavGroupButton" onClick={()=>setExpanded(v=>({...v,[group.label]:!isOpen}))}>
       <span className="globalNavIcon" aria-hidden="true">{group.icon}</span><span>{group.label}</span><b>{isOpen?"−":"+"}</b>
      </button>
      {isOpen&&<div className="globalNavChildren">{items.map(navItem)}</div>}
     </section>
    })}
   </nav>
   {user&&<footer className="globalNavUser">
    <div className="globalNavAvatar" aria-hidden="true">●</div>
    <div><strong>{user.matricula}</strong><span>{user.warName?.trim()||user.displayName.split(" ")[0]}</span></div>
    <button type="button" onClick={logout} title="Sair" aria-label="Sair">↪</button>
   </footer>}
  </aside>
 </>;
}
