"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {navPathMatches,sigdecDirectNav,sigdecNavGroups,type SigdecNavItem} from "./lib/navigation-model";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type User={matricula:string;displayName:string;warName:string|null;permissions:string[]};
type Feature={code:string;enabled:boolean};

export default function GlobalSidebar(){
 const pathname=usePathname();
 const[user,setUser]=useState<User|null>(null),[features,setFeatures]=useState<Record<string,boolean>>({});
 const[open,setOpen]=useState(false);
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
 const visible=(item:SigdecNavItem)=>(!item.feature||features[item.feature]!==false)&&(!item.admin||canAdmin);
 async function logout(){await fetch(API+"/auth/logout",{method:"POST",credentials:"include"});location.href="/login"}
 if(hidden)return null;
 const directItem=(item:SigdecNavItem)=><Link key={item.href} href={item.href} title={item.label} aria-label={item.label} className={navPathMatches(pathname,item.href)?"active":""} onClick={()=>setOpen(false)}><span className="globalNavIcon" aria-hidden="true">{item.icon}</span><span className="globalNavLabel">{item.label}</span></Link>;
 return <>
  {open&&<button className="globalNavBackdrop" type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
  <aside className={"sigdecGlobalSidebar "+(open?"mobileOpen":"")} aria-label="Navegação principal do SIGDEC">
   <header className="globalNavBrand" onClick={()=>setOpen(v=>!v)}>
    <img src="https://www.ubatuba.sp.gov.br/wp-content/uploads/sites/2/2015/02/brasao.png" alt="Brasão de Ubatuba"/>
    <div className="globalNavBrandText"><strong>SIGDEC</strong><small>Defesa Civil · Ubatuba</small></div>
    <button type="button" onClick={e=>{e.stopPropagation();setOpen(false)}} aria-label="Recolher menu">×</button>
   </header>
   <nav className="globalNavScroll" onClick={()=>{if(window.matchMedia("(max-width: 1024px)").matches&&!open)setOpen(true)}}>
    {sigdecDirectNav.filter(visible).map(directItem)}
    {sigdecNavGroups.map(group=>{
     const items=group.items.filter(visible);if(!items.length)return null;
     const active=items.some(item=>navPathMatches(pathname,item.href));
     return <Link key={group.label} href={group.href} title={group.label} aria-label={group.label} className={"globalNavMaster "+(active?"active":"")} onClick={()=>setOpen(false)}>
      <span className="globalNavIcon" aria-hidden="true">{group.icon}</span><span className="globalNavLabel">{group.label}</span>
     </Link>
    })}
   </nav>
   {user&&<footer className="globalNavUser" onClick={()=>{if(window.matchMedia("(max-width: 1024px)").matches&&!open)setOpen(true)}}>
    <div className="globalNavAvatar" aria-hidden="true">●</div>
    <div className="globalNavUserText"><strong>{user.matricula}</strong><span>{user.warName?.trim()||user.displayName.split(" ")[0]}</span></div>
    <button type="button" onClick={e=>{e.stopPropagation();void logout()}} title="Sair" aria-label="Sair">↪</button>
   </footer>}
  </aside>
 </>;
}
