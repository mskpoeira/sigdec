"use client";
import{useEffect,useState}from"react";
import{detectPhoneKind,formatBrPhone,normalizedBrPhone}from"./phone";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
export type ContactPhone={id?:string;kind:"PHONE";value:string;phoneType:"MOBILE"|"LANDLINE";isWhatsapp:boolean;isPrimary:boolean;label?:string;extension?:string};
export type PhonePersonMatch={id:string;sourceType:"VOLUNTEER"|"SHELTER_RESPONSIBLE"|"HOUSEHOLD_RESPONSIBLE"|"USER";fullName:string;phone?:string|null;email?:string|null;addressLine?:string|null;neighborhood?:string|null;profession?:string|null;education?:string|null;institution?:string|null;cnhCategory?:string|null;languages?:string[];operationRegion?:string|null;availability?:string|null;notes?:string|null};

export function PhoneListEditor({value,onChange,onPersonSelected,excludeOwnerId}:{value:ContactPhone[];onChange:(v:ContactPhone[])=>void;onPersonSelected?:(person:PhonePersonMatch)=>void;excludeOwnerId?:string|null}){
 const[input,setInput]=useState(""),[whatsapp,setWhatsapp]=useState(false),[extension,setExtension]=useState(""),[editing,setEditing]=useState<number|null>(null),[matches,setMatches]=useState<PhonePersonMatch[]>([]),[looking,setLooking]=useState(false);
 const kind=detectPhoneKind(input);
 useEffect(()=>{
  if(!onPersonSelected)return;
  const phone=normalizedBrPhone(input);if(!phone||!detectPhoneKind(input)){setMatches([]);return}
  const timer=setTimeout(async()=>{setLooking(true);try{const r=await fetch(`${API}/api/v1/people/lookup-by-phone?phone=${encodeURIComponent(phone)}`,{credentials:"include",cache:"no-store"});if(!r.ok){setMatches([]);return}const b=await r.json();setMatches((b.items??[]).filter((x:PhonePersonMatch)=>x.id!==excludeOwnerId))}catch{setMatches([])}finally{setLooking(false)}},350);
  return()=>clearTimeout(timer);
 },[input,onPersonSelected,excludeOwnerId]);
 function clear(){setInput("");setWhatsapp(false);setExtension("");setEditing(null);setMatches([])}
 function save(){const normalized=normalizedBrPhone(input);if(!normalized||!kind)return;const current=editing!==null?value[editing]:undefined;const item:ContactPhone={...(current??{}),kind:"PHONE",value:normalized,phoneType:kind,isWhatsapp:kind==="MOBILE"&&whatsapp,isPrimary:current?.isPrimary??value.length===0,extension:kind==="LANDLINE"?(extension||undefined):undefined};const next=[...value];if(editing===null)next.push(item);else next[editing]=item;onChange(next);clear()}
 function edit(i:number){const x=value[i];if(!x)return;setInput(formatBrPhone(x.value));setWhatsapp(x.isWhatsapp);setExtension(x.extension??"");setEditing(i)}
 function remove(i:number){const next=value.filter((_,n)=>n!==i);if(next.length&&!next.some(x=>x.isPrimary)){const first=next[0];if(first)next[0]={...first,isPrimary:true};}onChange(next);if(editing===i)clear()}
 function primary(i:number){onChange(value.map((x,n)=>({...x,isPrimary:n===i})))}
 function choose(p:PhonePersonMatch){if(!onPersonSelected)return;if(window.confirm(`Cadastro encontrado: ${p.fullName}. Deseja preencher os dados disponíveis deste cadastro?`)){onPersonSelected(p);setMatches([])}}
 return <div className="contactEditor"><label>Telefone<input inputMode="tel" value={input} onChange={e=>setInput(formatBrPhone(e.target.value))} placeholder="(12) 99999-9999"/></label>
  {kind?<small>{kind==="MOBILE"?"Celular":"Fixo"}</small>:input?<small>Informe DDD + número completo.</small>:null}
  {looking?<small>🔎 Buscando cadastro pelo telefone…</small>:null}
  {matches.length>0?<div className="phoneLookupResults" role="status"><strong>Cadastro encontrado</strong>{matches.map(p=><div className="contactRow" key={p.sourceType+":"+p.id}><span>👤 {p.fullName}</span><button type="button" className="secondaryButton" onClick={()=>choose(p)}>Usar dados</button></div>)}</div>:null}
  {kind==="MOBILE"?<label><input type="checkbox" checked={whatsapp} onChange={e=>setWhatsapp(e.target.checked)}/> WhatsApp</label>:null}
  {kind==="LANDLINE"?<label>Ramal<input value={extension} onChange={e=>setExtension(e.target.value.replace(/\D/g,"").slice(0,10))}/></label>:null}
  <button type="button" className="secondaryButton" disabled={!kind} onClick={save}>{editing===null?"Adicionar":"Salvar alteração"}</button>
  <div className="contactList">{value.map((x,i)=><div className="contactRow" key={x.id??i}><span>{x.phoneType==="MOBILE"?"📱":"📞"} {formatBrPhone(x.value)}{x.isWhatsapp?" · WhatsApp":""}{x.extension?" · Ramal "+x.extension:""}{x.isPrimary?" · Principal":""}</span><span><button type="button" title="Definir como principal" onClick={()=>primary(i)}>★</button><button type="button" title="Editar" onClick={()=>edit(i)}>✏️</button><button type="button" title="Excluir" onClick={()=>remove(i)}>−</button></span></div>)}</div>
 </div>;
}
