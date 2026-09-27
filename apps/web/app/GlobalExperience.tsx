"use client";

import type {Route} from "next";
import {usePathname,useRouter} from "next/navigation";
import {createPortal} from "react-dom";
import {useEffect,useMemo,useRef,useState} from "react";
import GlobalSidebar from "./GlobalSidebar";
import GlobalModuleTabs from "./GlobalModuleTabs";
import SigdecAiAssistant from "./SigdecAiAssistant";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
const DEFESA_CIVIL_LOGO="data:image/webp;base64,UklGRgYZAABXRUJQVlA4WAoAAAAQAAAAnwAAiQAAQUxQSKEFAAAB8EVrt2nbtm39KaXSOaxp27Zt27Zt27Zt27Ztu9tqNaX0v7RRW62lpJzna0RMAP5P1HqrEdQrtSju+P2vfqPSr337VtBKRE7+O6v9y8mqhQx4Bo94rUf4fFgdinNuj2SxefCC0DIMb6KzWufHh6EKw2VnkeXQ/dawKvSzdNYb/N2xIiUYbhrOip3PwlCB2IYfMUqK2H0BaAGGe8WMNTvfD5ue6El/ZBRFj5vAJmd4Kp1VR/78OJWJKc6xPaIszvhE2MQMr6Oz7ozt5xWblOISK8HKZ3w7dEpi9kl6aXReGzYhw41WPGsL/uhok+no+h/QWbzzEbDJGO5DZ/WZO84mOhHVE/+cUR6db4dNxPBkOutPX7kqbBKKs++IbACD392gMoUBb6Czic4HwSaguPTByDZEbDmT6PgMn6Kzkc43wkZnuO6Ks5l++PKwkYmu+zZbwm+sMxmX4e50NtR5L9ioRE/8PaMlkf8+nciYBjyBzqY6Xw0bkeLM2zPbknHgktDxGF5NZ2OdXxyG0Rgusc+zNXTeDcN4PkpncyP/crLIOBQ3cGeDZ3wJbBRiG7/DJqXvv7TYGAx3o7PJzk9BRyBy/B8ZbWLwdrDlGZ5IZ6M9f3uy6rJUzrYls1V0Phe2LMPr6Gx37L8odDmKixyIbJjzw2bLMXyIzpZ73gy2DMW1V4JND/76OJEl2MZv0tvGGZ+CYXGGu6Sz8Rl7zg9dlMhxv2e0js73wRZleAyd7Xe/PmwxKmfeEtEBwZ9uUlmI4ZV09qDzcbBFKC56INiFGTvOJbaAwT5C7wM634MFGK6z4uxFz2tC16TDNxn9wB9uUFmD4c4M9qPzobD5VI7/fXpHZGw7q+hchsfR2ZPOt8PmETnd1syuyJhdFTqH4eV09mXwW8MciovsjuwMBh8AOxWTD9DZHfnvM6muMuCaK87+dL4etoqu+xp7JOPQFWEADLejs0edXx5UIHLyb7NP6LwPDANuzGCn5PegEDnm24xO4S2hgOFa2SfOT4sCgMq7OeuQ9H0XxSomF9wd2R/OF8CwquEF9O6I/OspqquJnvZvGb3hvCsMpzrgAeyN4NdNMaeu/wGjK9IPXwE2j+G6EdkTM74ahnnF8EF6R2RuObPoXFBc8EBkP8z4IBjWaHgBZ93g/N5mk7WonunvEd2Q14VhzYaH0DvB+U4YFqgbf0Lvgoxt5xVdhOEm3gfOJ8OwUNNP0DvA8xfHqCxGcZGDkc1Lz1thwIIHvJTePOcnYFi0yun/HdG4jD0Xgi4MhkfSG+d8EQyLFz36F/SmRf71JJUlYMAtom3OO8GwVNXP0Bvm/KqZLMdw6QORDTt0ORiWPODV9GY5XwPDskXOuCWzURH/ObPo0mB4JL1RzgfCsHzRY35Nb1LwR+sVYzTctk05O3Jt2Chg9nl6g5zvEMNIcPmDns3J3H1u6EhgeD29OTM+HoaxCs66LbMxwV8eazIaGB5Lb4znLWAYr9jxv2A0xflRNYzZcDt6SzL2XgQ6Ktj6L9Mb4nw+DCPDFWfRjsg/nmw6MhjeSm+G8+4wjF3lHNsjG+H8sinGb3gSvQ0Zhy4Dm4Docb9jNMH5ehimaLhDzFqQ+e8ziEwCtv6r9AY47w/DNBVXi6jP+f1NKhOB4l308mJ2TRgmI+fZFVmc8x0wTNfwDHptGdvOIzoh0eP/zCjN+VgYpmy4C72y4K+PFpmU6Ppv0Avz2c1gmLbhqoy6nB9Rw9RV3kevKmPvRaEFXGhXZFHO52DA9A3PpdcU/PMJKgWInuavGSU57wJDhYb70ityfmGdSQnQdd9l1JNx5HJQ1Gi4ZkaW43w1DEWK4X30aiL/dQaVKqBykf2RxTgfBEOdhhfSawl+d72iUNEz/jVmUai7Xw1WCQw0HU2cZnLMpUJZVyBGJwoCN/oJ6Iwzw+30DVRdLK0U52CtdDknBzoSkkEpJN1l29rDI9bEbqBBGa+yN8J1HmvInbepi0wOhQ3tVWuHJyLbE115vraZD3YwGpKkIT5YTDYJ+ZNDYhH6MgRXtlNJV5CvWSdzMP3IIjSAu6Q9xbvrVXG9ZlvevW0T7sBoD5UdAU47aWPD/z6XlQ/H7CyzEaA3iiMzsmM+eoKk30DVBgU5asYYBokxP6Y87fF3S6qpG6tUNR58Ap667RRaI/FBQroet8uPpE0vD17UIj9cbm35117TfBbbYHi+QOPtBVgwL/6G24YeYtKHu4KEJJ1jUJKiFrVHWfVlaZeAXaMiRw4RySKu+pan2dNReJOztP0IYh5skZchXAX47PyIXAVjUPW+m13KIY7jlPa2iWUtqEapbECa58+eSTtu6ocjHuhI89DiWffjXFkpg4W573W+SEyy+G/sxg89jh+WSOPgogG3KBAwFFZi9XN+rq9L//0skFVIFJSqvfTIA9kdHdb5o+c/CIx3oJQ1xhXnvi/NiT79/tqNw43Pe4oDreN3Klw/QTKQoHAWzExu92QNaEhFhHpGqIZ1fgva08dQM+KqNa3mCmcYWtOFsiJoG+leguARQNiCPBIX7QGyg7Q1Pw7nzKL1wLGhrP9QuZYkSgf69E7fJk851o93VmYbabOzoWHx6fqjCFjRwVvKWYGOKIfOfXM0pyFa89UjzkuzYQiKfvmkJA78ZRHIMhUnAl/YsS9455zyNZ+nRkXomTdXrngj97GkH3seuk7EP/OhH2hUD1JYDUZltN1/9IaHZ+Db+Ig3+NSYRioW4S1a5/jQgMkuw2ghHoS8HYSeBdXrIONf/9m61oPcC+bmMdHIxcQ5D9/vhN7my7Ju4BZ156wg5J7kJ5GvzDEF+4fIlucBaj4FfvGjtIsMK0/GcS32bh9dIimwPfJ8A4ZwzmHcFXmATzfnWO6GHHwoBqTIYYHfMR08OGqs5CS74HRCdvzEVqwErc1+wqN2bDUcaPD9hdjTzPMuCo2/d/UZr4GdhMg+MqKj6/kxNjXQF9I2qTHFRghhXs+3Lkouwd4cVWZbUuP4/oI6Bm3VHps+IIo6ORiM7yp/Gct8m0XEPjEjgyAFO61B6Flamzz7F9fw6/Rf0P5xV1CJMXFpCSiNJtDn241QVbHrOYST1R6j9wBdsCthiMCpbQ4dOP1eLSXAvzlZC1r3GgUf8BG/pBstcU9qiI+TT+uj0Urh9+GG5Z4nfoj6FWm0IuOqgR9Y+GgWWdNZHpzN0yJZpVTH4mbg4q+CQ4b6so04Wida1atcGqud5fXuvqxyiO7hpjRvSd467iSx3dbeOOLa6iY9zq9Jniebc4CY8TE06Fzmgw8PfUn1LoQH2m4ljLteTQR91paEmF5B1FBirETQdV1q/aDPM19AQuVqBOJbh9eHZQEAnMGnJbyI/oquQ0Ne76dGBUbqVEiotnfu80+LaB1bZgxw0IlWH/FYJju8X1jzKwNKt65xPCQAARrUUuoL2Go7q9clEI2IL8FzgcOYdmR0Cmkn3XhKFlG9YBZ14p3O3O7GQgjpQa+qIs7RpCjsINfas1dUaYjYEHF2GxKJLL5REoaAd0x3GqyrluGTAxyGXyuYZXDLdq0GXbBcb/p8d3pvkqovoFkxbu7tS88NCP/xb7wDwvXY69jdNHK4o0xFj4aIGP8ZTTe5fu4ZuBEkue/kWmGj8nnFJRbGKnPVXGL7JQPgOtk0M72WQBs+N67rq0hbBflB9vhxiUNt6XJJ92Mf0nFAyZ0Ohj6hSyvTCGViQPz0K1Pe9QuqYhhkr4VRsAqR0aSWVp/NLSK/3A7rzxBVH5mO+pWT+4hyu3BYtpucumwti5zcap/WxJbVC92xPycORwfTcqfnVPODIkyqxPXiQScnSAvrZUD7B+cPJyhagnmHw/3Jy0RAd6DQd/0G60W546CiS1FFQksAPPylOGMnafDy2a6xdnTlWmOAjlRw3pVVNaG8610Kg0BW9a9kT0dYUDbdSK8u/t0TeGTdA3Ds97lDHZbCuCpV7u+I0tb+xvfFlInMZ0FF5R5u9Vm+LJclv/FGVmGfwWd5mOsevGidInVe83vWIjR8q34BNk0dLPjixA/Jg3Tpd1D+oKA3xWhZ3tgtA2FGHtskYxpO/rExnAD1pVxQb/+1tJeqxbp52Iu1t0LjxDI0SGFSDQ3nZ20cAJ/SdSBnBATLnn/bJ8OalM0JkhCKUpegImz1r6EzZewJnTSPpaxgSQqspFdieJhv53MM//yuF3OPyuz9svVoH8t892/6W1TlTa8gAVkgr65MsYCPA5CIgziRWpEA7S42ThNnDjRTUg5xbqOE/8sqFn/1Kdj5aVpQG1+HEZxxZoO+/J5PzTUgjTF9KQAOSu2CpOafTuAvoRgc8Rtpqfe1TbQe0EI3GDK/GHQ9lvoAu1T5Y1xdfHd3VwofPQhN/KRWMtozqhZDdfML/C4iTjDyQJgBAuIxiDz2x+aOmXGjBvtPfCrmolcx3x1uiFDdP8lwPf7PaLFJN1t/7XUjbVJx3NoXuDB9xljfz5gdCtnL+sVlGpB/8haVZI8yWnx6wNF2x01+z19CyBB9L0Bm2PCu8uhkqcDPye4Uc0KK3rwWk0LsV+MOB9NmbcodeE9zPQRjzaLfU6QULPyqo2SRn0EAgsOdrauutemtNrHvdJSbWftB9oVDnu2rDbBLToxU0klPnw+7cGmkilppOAZOVIeeZG4XzqBpm9fGHiYBUMqkq/fB9hVP0nzVGjBs8TvKPdu4RFS76t16oD0NI+30pXM8i9NapFKZPIuFCZWd69CtUmXIl/9PCd3FPSvfDV6UnLXF0fnGrDei9vki+7C9nqrXEz+ZiJcZnBF2TBE5STxAlc/Bo1MpcGkckEu+wq6q5DyifMGwgZExN/kEmue+D2imTccupe43fyKQYxEcMZp4USPgAjYnxM1JbZfOY0NERRj4FwTRt9hxMzcCzTTLGgESTmLjR899KhLUH/F+O2VmCxO3vE6JjcoPLbcVzp7dAHZM3HJ4fKmkkxBTnzGGWV8utxLOV8QLQzUSrieBjEiEoqQFfDKJitDjIdOPSZGFvP93y9mZpcwrY+2ZRdxrAPEG0W78hwr/vIAEboCRuIl5nmuOnK7vUWK9HwRmmBWZ/ieQ/y9dhWCRjoTJSKPIXyK4wmotKjBbBGFfmSvJ/2ra73nxIZkmS0A77Zw0j7ri7IYh6AEXo7AXTFWeb+UDChR2wccQ6LbjzEkHncwCQR+GKa41t8Rut3r++MAsKGRJ9yC+bxX9eDaqFwZHuzeOT5kmeFWReSca81rkGIxCe/VowGpThtvKrINnHLLPABAURmzfYEo3HyBpyLfDt+UtIpmIYSfK80LxEeTYO3NsrDpyG4JIbZUTB61RZMIyQ+YUdU2trDrAMuoYVGK6fmI53JaH0lQ65wKba1NscF3s6SuYMn5Z7YuW1ESj4+LIhukRC6VKRA8yro+2ltdcw0AaIExIR/FeJ5HYafGaVwMlF33e93m5UKPVu7OEhXw7Uiy59C6yBqvwlm4JgAoq+Og6IvvpSBGYcw33s8XXcTIEDceSeJjJBgbF4qqlI70J0Qf+/tZcxY7FsDKuDLZdC4zZ34U5aCEAsKgMNhkcNHNSUJ4cDHB34TBT2TnnQxedrqyG+M+WsP1FLLC95ludey0naFnrw8ysuKyYCIbp5yA+NPODGC8ou/j9uT+PF7cWN53egvqKKrkZyGBxO0AjDKNtP4cagphMAAA5x8yl6saCiOy6nmgJUSLkyDbBRf8Z9KI8BZgbVxd3kds4T4aix0gY4TzkpTFu+a6BF5f2AygRDRJW/2TxYCPCyaTyQi6myF4eRaxwhE+WDbbXMjJwpWz8/Ozuq3TdLBgNHb8p+ZaNDj4BHhMFwZUIS1u84kpRs1flgbEw/1Odr3ysAAAAAA==";

type Result={
 kind:string;title:string;subtitle:string;meta?:string|null;href:string;status?:string|null;icon:string;
};

const publicPrefixes=["/login","/esqueci-senha","/redefinir-senha","/alterar-senha","/integridade","/verificar-integridade","/offline"];
const labels:Record<string,string>={
 painel:"Painel",ocorrencias:"Ocorrências",nova:"Nova ocorrência",extrato:"Extrato",sidec:"SIDEC",
 campo:"Riscos e Mapas",monitoramento:"Monitoramento Ambiental",vistorias:"Vistorias",assistencia:"Assistência Humanitária",
 voluntarios:"Voluntariado",planejamento:"Planejamento e Contingência",operacao:"Operação PLANCON",gestao:"Centro de Gestão",
 sco:"SCO",comunicacoes:"Comunicações",resiliencia:"Resiliência",apoios:"Apoios Estado/União",capacitacao:"Capacitação",
 "ajuda-mutua":"Ajuda Mútua","operacoes-sazonais":"Operações Sazonais",simulados:"Simulados e AAR/IP",
 documentos:"Documentos",continuidade:"Continuidade",administracao:"Administração",usuarios:"Usuários",
 cadastros:"Cadastros Operacionais",integracoes:"Integrações",email:"E-mail institucional",provedores:"Central de IA","gestao-riscos":"Gestão do Risco",auditoria:"Auditoria",saude:"Saúde do Sistema",apresentacao:"Apresentação"
};
const kindLabels:Record<string,string>={
 INCIDENT:"Ocorrência",HOUSEHOLD:"Família",SHELTER:"Abrigo",ITEM:"Item",VOLUNTEER:"Voluntário",TEAM:"Equipe",
 VEHICLE:"Viatura",DOCUMENT:"Documento",STATION:"Estação",PLANCON:"PLANCON",SUPPORT:"Apoio externo",USER:"Usuário"
};

function humanize(segment:string,index:number,parts:string[]){
 if(labels[segment])return labels[segment];
 if(index>0&&parts[index-1]==="ocorrencias")return "Detalhe da ocorrência";
 if(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment))return "Detalhe";
 return segment.replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

export default function GlobalExperience(){
 const pathname=usePathname(),router=useRouter();
 const[open,setOpen]=useState(false),[query,setQuery]=useState(""),[results,setResults]=useState<Result[]>([]);
 const[loading,setLoading]=useState(false),[selected,setSelected]=useState(0),[header,setHeader]=useState<Element|null>(null);
 const[realtimeTransport,setRealtimeTransport]=useState<"connecting"|"sse"|"polling"|"offline">("connecting");
 const[lastRealtimeAt,setLastRealtimeAt]=useState<Date|null>(null);
 const inputRef=useRef<HTMLInputElement|null>(null);
 const hidden=pathname==="/"||publicPrefixes.some(x=>pathname.startsWith(x));

 useEffect(()=>{
  if(hidden){setHeader(null);return}
  const raf=requestAnimationFrame(()=>setHeader(document.querySelector(".moduleShell > .listHeader:first-child")));
  return()=>cancelAnimationFrame(raf);
 },[pathname,hidden]);

 useEffect(()=>{
  if(hidden)return;
  const emit=(detail:Record<string,unknown>={})=>{
   const at=Date.now();
   setLastRealtimeAt(new Date(at));
   window.dispatchEvent(new CustomEvent("sigdec:realtime-tick",{detail:{at,...detail}}));
   router.refresh();
  };
  const tick=()=>{
   if(document.visibilityState!=="visible")return;
   if(!navigator.onLine){setRealtimeTransport("offline");return}
   if(realtimeTransport==="sse")return;
   setRealtimeTransport("polling");
   emit({transport:"polling",reason:"fallback"});
  };
  const timer=window.setInterval(tick,5000);
  const onOnline=()=>{setRealtimeTransport("connecting");tick()};
  const onOffline=()=>setRealtimeTransport("offline");
  window.addEventListener("online",onOnline);
  window.addEventListener("offline",onOffline);
  return()=>{window.clearInterval(timer);window.removeEventListener("online",onOnline);window.removeEventListener("offline",onOffline)};
 },[hidden,router,realtimeTransport]);

 useEffect(()=>{
  if(hidden||!navigator.onLine)return;
  setRealtimeTransport("connecting");
  const source=new EventSource(API+"/api/v1/realtime",{withCredentials:true});
  source.addEventListener("ready",()=>setRealtimeTransport("sse"));
  source.addEventListener("change",(event)=>{
   let change:Record<string,unknown>={};
   try{change=JSON.parse((event as MessageEvent).data??"{}") as Record<string,unknown>}catch{}
   const at=Date.now();
   setRealtimeTransport("sse");setLastRealtimeAt(new Date(at));
   window.dispatchEvent(new CustomEvent("sigdec:realtime-tick",{detail:{at,transport:"sse",...change}}));
   router.refresh();
  });
  source.onerror=()=>{if(navigator.onLine)setRealtimeTransport("polling")};
  return()=>source.close();
 },[hidden,router]);

 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){
    event.preventDefault();setOpen(value=>!value);return;
   }
   if(event.key==="Escape")setOpen(false);
  };
  window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
 },[]);

 useEffect(()=>{
  if(!open){setQuery("");setResults([]);setSelected(0);return}
  const timer=setTimeout(()=>inputRef.current?.focus(),30);return()=>clearTimeout(timer);
 },[open]);

 useEffect(()=>{
  if(!open||query.trim().length<2){setResults([]);setLoading(false);return}
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);
   try{
    const response=await fetch(API+"/api/v1/search?q="+encodeURIComponent(query.trim())+"&limit=40",{credentials:"include",cache:"no-store",signal:controller.signal});
    if(response.status===401){setOpen(false);return}
    const body=await response.json().catch(()=>({}));
    if(response.ok){setResults(body.items??[]);setSelected(0)}
   }catch(error){
    if(!(error instanceof DOMException&&error.name==="AbortError"))setResults([]);
   }finally{if(!controller.signal.aborted)setLoading(false)}
  },220);
  return()=>{clearTimeout(timer);controller.abort()};
 },[open,query]);

 const crumbs=useMemo(()=>{
  if(hidden||pathname==="/painel")return [];
  const parts=pathname.split("/").filter(Boolean);
  return [{label:"Painel",href:"/painel"},...parts.map((part,index)=>({
   label:humanize(part,index,parts),href:"/"+parts.slice(0,index+1).join("/")
  }))];
 },[pathname,hidden]);

 const go=(href:string)=>{setOpen(false);router.push(href as Route)};

 if(hidden)return null;

 const headerBrand=header?createPortal(<span className="moduleHeaderDefenseMark"><img src={DEFESA_CIVIL_LOGO} alt="Logo da Defesa Civil de Ubatuba"/></span>,header):null;
 const tabs=header?createPortal(<GlobalModuleTabs/>,header):null;

 const breadcrumb=header&&crumbs.length>0?createPortal(
  <nav className="contextBreadcrumb" aria-label="Navegação estrutural">
   {crumbs.map((item,index)=><span key={item.href}>
    {index>0&&<b aria-hidden="true">›</b>}
    {index===crumbs.length-1?<strong>{item.label}</strong>:<button type="button" onClick={()=>go(item.href)}>{item.label}</button>}
   </span>)}
  </nav>,header
 ):null;

 return <>
  <GlobalSidebar/>
  <SigdecAiAssistant/>
  {headerBrand}
  {tabs}
  {breadcrumb}
  <div className={`realtimeStatus ${realtimeTransport}`} title={lastRealtimeAt?`Última sincronização: ${lastRealtimeAt.toLocaleTimeString("pt-BR")}`:"Conectando..."}>
   <span aria-hidden="true">●</span><strong>{realtimeTransport==="sse"?"Tempo real":realtimeTransport==="polling"?"Atualização 5 s":realtimeTransport==="offline"?"Offline":"Conectando"}</strong>
  </div>
  <button type="button" className="globalSearchLauncher" onClick={()=>setOpen(true)} aria-label="Abrir busca global">
   <span aria-hidden="true">⌕</span><strong>Buscar no SIGDEC</strong><kbd>Ctrl K</kbd>
  </button>

  {open&&<div className="commandOverlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
   <section className="commandPalette" role="dialog" aria-modal="true" aria-label="Busca global do SIGDEC">
    <header className="commandHeader">
     <span aria-hidden="true">⌕</span>
     <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Protocolo, pessoa, abrigo, viatura, equipe, documento, PLANCON..." aria-label="Termo de busca"
      onKeyDown={event=>{
       if(event.key==="ArrowDown"){event.preventDefault();setSelected(v=>Math.min(results.length-1,v+1))}
       if(event.key==="ArrowUp"){event.preventDefault();setSelected(v=>Math.max(0,v-1))}
       if(event.key==="Enter"&&results[selected]){event.preventDefault();go(results[selected].href)}
      }}/>
     <button type="button" onClick={()=>setOpen(false)} aria-label="Fechar busca">×</button>
    </header>

    {query.trim().length<2?<div className="commandIntro">
     <div><kbd>Ctrl K</kbd><span>abre a busca em qualquer tela</span></div>
     <div><kbd>↑ ↓</kbd><span>navega pelos resultados</span></div>
     <div><kbd>Enter</kbd><span>abre o registro selecionado</span></div>
     <nav className="commandQuick" aria-label="Acessos rápidos">
      <button onClick={()=>go("/ocorrencias")}>⚠ Ocorrências</button>
      <button onClick={()=>go("/assistencia")}>♥ Assistência</button>
      <button onClick={()=>go("/planejamento")}>▦ PLANCON</button>
      <button onClick={()=>go("/monitoramento")}>◉ Monitoramento</button>
      <button onClick={()=>go("/apresentacao")}>▶ Apresentar SIGDEC</button>
     </nav>
    </div>:loading?<div className="commandState"><span className="commandSpinner"/>Pesquisando em módulos autorizados...</div>
    :results.length===0?<div className="commandState">Nenhum registro encontrado para <strong>{query.trim()}</strong>.</div>
    :<div className="commandResults" role="listbox" aria-label="Resultados">
      {results.map((item,index)=><button type="button" role="option" aria-selected={index===selected} className={index===selected?"selected":""} key={item.kind+"-"+item.href+"-"+index} onMouseEnter={()=>setSelected(index)} onClick={()=>go(item.href)}>
       <span className="commandResultIcon" aria-hidden="true">{item.icon}</span>
       <span className="commandResultText"><strong>{item.title}</strong><small>{kindLabels[item.kind]??item.kind}{item.subtitle?" · "+item.subtitle:""}</small></span>
       <span className="commandResultMeta">{item.meta??item.status??""}</span>
      </button>)}
    </div>}
    <footer className="commandFooter"><span>Busca respeita as permissões do usuário e a organização ativa.</span><kbd>Esc</kbd></footer>
   </section>
  </div>}
 </>;
}
