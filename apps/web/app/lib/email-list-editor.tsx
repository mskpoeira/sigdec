"use client";
import{useState}from"react";
export type ContactEmail={id?:string;value:string;kind:"EMAIL";isPrimary:boolean;label?:string;isWhatsapp:false};
export function EmailListEditor({value,onChange}:{value:ContactEmail[];onChange:(v:ContactEmail[])=>void}){
 const[input,setInput]=useState(""),[editing,setEditing]=useState<number|null>(null);const valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
 function clear(){setInput("");setEditing(null)}
 function save(){if(!valid)return;const current=editing!==null?value[editing]:undefined;const item:ContactEmail={...(current??{}),kind:"EMAIL",value:input.trim().toLowerCase(),isPrimary:current?.isPrimary??value.length===0,isWhatsapp:false};const next=[...value];if(editing===null)next.push(item);else next[editing]=item;onChange(next);clear()}
 function edit(i:number){const x=value[i];if(!x)return;setInput(x.value);setEditing(i)}
 function remove(i:number){const next=value.filter((_,n)=>n!==i);if(next.length&&!next.some(x=>x.isPrimary)){const first=next[0];if(first)next[0]={...first,isPrimary:true}}onChange(next);if(editing===i)clear()}
 function primary(i:number){onChange(value.map((x,n)=>({...x,isPrimary:n===i})))}
 return <div className="contactEditor"><label>E-mail<input type="email" value={input} onChange={e=>setInput(e.target.value)} placeholder="nome@exemplo.com"/></label><button type="button" className="secondaryButton" disabled={!valid} onClick={save}>{editing===null?"Adicionar":"Salvar alteração"}</button><div className="contactList">{value.map((x,i)=><div className="contactRow" key={x.id??i}><span>✉️ {x.value}{x.isPrimary?" · Principal":""}</span><span><button type="button" title="Definir como principal" onClick={()=>primary(i)}>★</button><button type="button" title="Editar" onClick={()=>edit(i)}>✏️</button><button type="button" title="Excluir" onClick={()=>remove(i)}>−</button></span></div>)}</div></div>
}
