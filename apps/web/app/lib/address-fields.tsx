"use client";
import {useState} from "react";

export type AddressValue={postalCode:string;street:string;number:string;complement:string;neighborhood:string;city:string;state:string};
export function emptyAddress():AddressValue{return{postalCode:"",street:"",number:"",complement:"",neighborhood:"",city:"",state:""}}
export function AddressFields({value,onChange,prefix=""}:{value:AddressValue;onChange:(v:AddressValue)=>void;prefix?:string}){
 const[lookup,setLookup]=useState<"idle"|"loading"|"found"|"not_found"|"unavailable">("idle");
 function set<K extends keyof AddressValue>(k:K,v:AddressValue[K]){onChange({...value,[k]:v})}
 async function findCep(raw:string){
  const cep=raw.replace(/\D/g,"").slice(0,8);set("postalCode",cep.length>5?cep.replace(/(\d{5})(\d{1,3})/,"$1-$2"):cep);
  if(cep.length!==8){setLookup("idle");return}
  setLookup("loading");
  try{
   const r=await fetch(`https://viacep.com.br/ws/${cep}/json/`,{cache:"no-store"});
   if(!r.ok)throw new Error("lookup unavailable");
   const d=await r.json();
   if(d.erro){setLookup("not_found");return}
   onChange({...value,postalCode:cep.replace(/(\d{5})(\d{3})/,"$1-$2"),street:d.logradouro??value.street,neighborhood:d.bairro??value.neighborhood,city:d.localidade??value.city,state:d.uf??value.state});
   setLookup("found");
  }catch{setLookup("unavailable")}
 }
 return <fieldset className="addressFields"><legend>Endereço</legend>
  <div className="formGrid">
   <label>CEP<input name={prefix+"postalCode"} inputMode="numeric" autoComplete="postal-code" value={value.postalCode} onChange={e=>void findCep(e.target.value)} placeholder="00000-000"/></label>
   <label>Logradouro<input name={prefix+"street"} value={value.street} onChange={e=>set("street",e.target.value)} autoComplete="address-line1"/></label>
   <label>Número<input name={prefix+"number"} value={value.number} onChange={e=>set("number",e.target.value)}/></label>
   <label>Complemento<input name={prefix+"complement"} value={value.complement} onChange={e=>set("complement",e.target.value)} autoComplete="address-line2"/></label>
   <label>Bairro<input name={prefix+"neighborhood"} value={value.neighborhood} onChange={e=>set("neighborhood",e.target.value)}/></label>
   <label>Cidade<input name={prefix+"city"} value={value.city} onChange={e=>set("city",e.target.value)} autoComplete="address-level2"/></label>
   <label>UF<input name={prefix+"state"} value={value.state} onChange={e=>set("state",e.target.value.toUpperCase().slice(0,2))} maxLength={2} autoComplete="address-level1"/></label>
  </div>
  {lookup==="loading"&&<small>Consultando CEP...</small>}
  {lookup==="found"&&<small>CEP localizado. Confira número e complemento.</small>}
  {lookup==="not_found"&&<small className="fieldWarning">CEP não localizado. Preencha o endereço manualmente.</small>}
  {lookup==="unavailable"&&<small className="fieldWarning">Consulta de CEP indisponível. O cadastro pode continuar com endereço manual.</small>}
 </fieldset>;
}
