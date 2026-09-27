"use client";
import{useState}from"react";import{detectPhoneKind,formatBrPhone,normalizedBrPhone}from"./phone";
export type ContactPhone={id?:string;kind:"PHONE";value:string;phoneType:"MOBILE"|"LANDLINE";isWhatsapp:boolean;isPrimary:boolean;label?:string;extension?:string};
export function PhoneListEditor({value,onChange}:{value:ContactPhone[];onChange:(v:ContactPhone[])=>void}){
 const[input,setInput]=useState(""),[whatsapp,setWhatsapp]=useState(false),[extension,setExtension]=useState(""),[editing,setEditing]=useState<number|null>(null);
 const kind=detectPhoneKind(input);
 function clear(){setInput("");setWhatsapp(false);setExtension("");setEditing(null)}
 function save(){const normalized=normalizedBrPhone(input);if(!normalized||!kind)return;const current=editing!==null?value[editing]:undefined;const item:ContactPhone={...(current??{}),kind:"PHONE",value:normalized,phoneType:kind,isWhatsapp:kind==="MOBILE"&&whatsapp,isPrimary:current?.isPrimary??value.length===0,extension:kind==="LANDLINE"?(extension||undefined):undefined};const next=[...value];if(editing===null)next.push(item);else next[editing]=item;onChange(next);clear()}
 function edit(i:number){const x=value[i];if(!x)return;setInput(formatBrPhone(x.value));setWhatsapp(x.isWhatsapp);setExtension(x.extension??"");setEditing(i)}
 function remove(i:number){const next=value.filter((_,n)=>n!==i);if(next.length&&!next.some(x=>x.isPrimary)){const first=next[0];if(first)next[0]={...first,isPrimary:true};}onChange(next);if(editing===i)clear()}
 function primary(i:number){onChange(value.map((x,n)=>({...x,isPrimary:n===i})))}
 return <div className="contactEditor"><label>Telefone<input inputMode="tel" value={input} onChange={e=>setInput(formatBrPhone(e.target.value))} placeholder="(12) 99999-9999"/></label>
  {kind?<small>{kind==="MOBILE"?"Celular":"Fixo"}</small>:input?<small>Informe DDD + número completo.</small>:null}
  {kind==="MOBILE"?<label><input type="checkbox" checked={whatsapp} onChange={e=>setWhatsapp(e.target.checked)}/> WhatsApp</label>:null}
  {kind==="LANDLINE"?<label>Ramal<input value={extension} onChange={e=>setExtension(e.target.value.replace(/\D/g,"").slice(0,10))}/></label>:null}
  <button type="button" className="secondaryButton" disabled={!kind} onClick={save}>{editing===null?"Adicionar":"Salvar alteração"}</button>
  <div className="contactList">{value.map((x,i)=><div className="contactRow" key={x.id??i}><span>{x.phoneType==="MOBILE"?"📱":"📞"} {formatBrPhone(x.value)}{x.isWhatsapp?" · WhatsApp":""}{x.extension?" · Ramal "+x.extension:""}{x.isPrimary?" · Principal":""}</span><span><button type="button" title="Definir como principal" onClick={()=>primary(i)}>★</button><button type="button" title="Editar" onClick={()=>edit(i)}>✏️</button><button type="button" title="Excluir" onClick={()=>remove(i)}>−</button></span></div>)}</div>
 </div>;
}
