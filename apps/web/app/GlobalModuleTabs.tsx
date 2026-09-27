"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {groupForPath,navPathMatches,type SigdecNavItem} from "./lib/navigation-model";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type User={permissions:string[]};
type Feature={code:string;enabled:boolean};

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
 const items=group.items.filter(visible);\n if(!items.length)return null;\n const activeHref=items.filter(item=>navPathMatches(pathname,item.href)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;\n return <nav className="globalModuleTabs" aria-label={"Abas de "+group.label}>
  <div className="globalModuleTabsTitle"><span aria-hidden="true">{group.icon}</span><strong>{group.label}</strong></div>
  <div className="globalModuleTabsScroll">
   {items.map(item=><Link key={item.href} href={item.href} className={item.href===activeHref?"active":""}>
    <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
   </Link>)}
  </div>
 </nav>;
}
