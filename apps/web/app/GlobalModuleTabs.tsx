"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {groupForPath,navPathMatches,sigdecDirectNav,sigdecNavGroups,type SigdecNavItem} from "./lib/navigation-model";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type User={permissions:string[]};
type Feature={code:string;enabled:boolean};
type TabTone="red"|"blue"|"green"|"orange"|"purple"|"navy"|"gray";

function tabTone(item:SigdecNavItem):TabTone{
 const href=item.href;
 if(href==="/administracao/usuarios")return "blue";
 if(href==="/administracao/cadastros")return "green";
 if(href==="/administracao/integracoes")return "purple";
 if(href==="/administracao/auditoria")return "orange";
 if(href==="/administracao/saude")return "green";
 if(href==="/administracao/base-legal")return "gray";
 if(href==="/administracao/apresentacao")return "navy";
 if(href.startsWith("/administracao"))return "navy";
 if(href.startsWith("/planejamento"))return "purple";
 if(href.startsWith("/gestao-riscos"))return "green";
 if(href.startsWith("/monitoramento"))return "blue";
 if(href.startsWith("/resiliencia"))return "green";
 if(href.startsWith("/inteligencia/provedores"))return "purple";
 if(href.startsWith("/inteligencia"))return "navy";
 if(href.startsWith("/documentos"))return "blue";
 if(href.startsWith("/sco"))return "red";
 if(href.startsWith("/gestao"))return "gray";
 if(href.includes("/email"))return "orange";
 if(href.startsWith("/comunicacoes"))return "blue";
 return "navy";
}

export default function GlobalModuleTabs(){
 const pathname=usePathname(),group=groupForPath(pathname);
 const[user,setUser]=useState<User|null>(null),[features,setFeatures]=useState<Record<string,boolean>>({});
 useEffect(()=>{
  if(!group)return;
  fetch(API+"/auth/me",{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setUser(b.user)).catch(()=>{});
  fetch(API+"/api/v1/features",{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(b=>b&&setFeatures(Object.fromEntries((b.items??[]).map((x:Feature)=>[x.code,x.enabled])))).catch(()=>{});
 },[group?.label]);
 if(!group)return null;
 const canAdmin=!!user&&["admin.features","integrations.manage","system.master","audit.read","users.manage"].some(p=>user.permissions.includes(p));
 const visible=(item:SigdecNavItem)=>(!item.feature||features[item.feature]!==false)&&(!item.admin||canAdmin);
 const sidebarHrefs=new Set<string>([...sigdecDirectNav.map(item=>item.href),...sigdecNavGroups.map(item=>item.href)]);
 const items=group.items.filter(item=>visible(item)&&!sidebarHrefs.has(item.href));
 if(!items.length)return null;
 const activeHref=items.filter(item=>navPathMatches(pathname,item.href)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 return <nav className="globalModuleTabs" aria-label={"Abas de "+group.label}>
  <div className="globalModuleTabsTitle"><span aria-hidden="true">{group.icon}</span><strong>{group.label}</strong></div>
  <div className="globalModuleTabsScroll">
   {items.map(item=><Link key={item.href} href={item.href} data-tone={tabTone(item)} className={item.href===activeHref?"active":""}>
    <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
   </Link>)}
  </div>
 </nav>;
}
