"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Agreement={
 id:string;partnerName:string;partnerType:string;agreementReference:string|null;startsAt:string|null;endsAt:string|null;
 status:string;liabilityTerms:string|null;reimbursementTerms:string|null;contacts:string[];capabilities:string[];notes:string|null;
 createdAt:string;resourceCount:number;
};
type Resource={id:string;resourceType:string;resourceName:string;capabilityType:string|null;quantity:number|null;unit:string|null;leadTimeMinutes:number|null;availabilityNotes:string|null;active:boolean};

const partnerLabels:Record<string,string>={MUNICIPALITY:"Município",STATE:"Estado",FEDERAL:"União",FIRE_DEPARTMENT:"Corpo de Bombeiros",NGO:"ONG",PRIVATE:"Empresa",UTILITY:"Concessionária",OTHER:"Outro"};
const resourceLabels:Record<string,string>={PERSONNEL:"Pessoal",TEAM:"Equipe",VEHICLE:"Viatura",EQUIPMENT:"Equipamento",FACILITY:"Instalação",SUPPLY:"Suprimento",SERVICE:"Serviço",OTHER:"Outro"};

export default function AjudaMutuaPage(){
 const[items,setItems]=useState<Agreement[]>([]);
 const[selected,setSelected]=useState<Agreement|null>(null);
 const[resources,setResources]=useState<Resource[]>([]);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");
  return body;
 },[]);

 const load=useCallback(async()=>{const b=await request("/api/v1/mutual-aid");setItems(b.items??[])},[request]);
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar."))},[load]);

 async function open(item:Agreement){
  setSelected(item);const b=await request("/api/v1/mutual-aid/"+item.id+"/resources");setResources(b.items??[]);
 }
 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load();if(selected)await open(selected)}catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}finally{setBusy(false)}}

 async function createAgreement(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  const contacts=String(d.get("contacts")??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const capabilities=String(d.get("capabilities")??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  await perform(async()=>{
   await request("/api/v1/mutual-aid",{method:"POST",body:JSON.stringify({
    partnerName:String(d.get("partnerName")??""),partnerType:String(d.get("partnerType")??"MUNICIPALITY"),
    agreementReference:String(d.get("agreementReference")??""),startsAt:String(d.get("startsAt")??"")||undefined,
    endsAt:String(d.get("endsAt")??"")||undefined,status:String(d.get("status")??"DRAFT"),
    liabilityTerms:String(d.get("liabilityTerms")??""),reimbursementTerms:String(d.get("reimbursementTerms")??""),
    contacts,capabilities,notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Acordo de ajuda mútua cadastrado.");
  });
 }

 async function addResource(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected)return;
  const form=e.currentTarget,d=new FormData(form),quantity=String(d.get("quantity")??"").trim(),lead=String(d.get("leadTimeMinutes")??"").trim();
  await perform(async()=>{
   await request("/api/v1/mutual-aid/"+selected.id+"/resources",{method:"POST",body:JSON.stringify({
    resourceType:String(d.get("resourceType")??"TEAM"),resourceName:String(d.get("resourceName")??""),
    capabilityType:String(d.get("capabilityType")??""),quantity:quantity?Number(quantity):undefined,
    unit:String(d.get("unit")??""),leadTimeMinutes:lead?Number(lead):undefined,
    availabilityNotes:String(d.get("availabilityNotes")??"")
   })});form.reset();setMessage("Capacidade/recurso incluído no acordo.");
  });
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · AJUDA MÚTUA · {SIGDEC_VERSION_LABEL}</span><h1>Rede de Apoio e Recursos Compartilháveis</h1>
    <p>Acordos intermunicipais e institucionais, capacidades, prazos de mobilização e condições de responsabilidade/reembolso.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/resiliencia">Centro de Resiliência</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>
  {message&&<section className="infoCard">{message}</section>}

  <section style={{marginTop:18}}>
   <h2>Novo acordo</h2>
   <form className="incidentForm compactForm" onSubmit={createAgreement}>
    <div className="formGrid">
     <label>Parceiro<input name="partnerName" required/></label>
     <label>Tipo<select name="partnerType">{Object.keys(partnerLabels).map(x=><option key={x} value={x}>{partnerLabels[x]}</option>)}</select></label>
     <label>Referência do acordo<input name="agreementReference" placeholder="Convênio, termo, MOU..."/></label>
     <label>Início<input name="startsAt" type="date"/></label>
     <label>Fim<input name="endsAt" type="date"/></label>
     <label>Status<select name="status"><option value="DRAFT">Rascunho</option><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option><option value="EXPIRED">Expirado</option><option value="CLOSED">Encerrado</option></select></label>
    </div>
    <div className="formGrid"><label>Contatos · um por linha<textarea name="contacts" rows={4}/></label><label>Capacidades · uma por linha<textarea name="capabilities" rows={4}/></label></div>
    <label>Responsabilidades / liability<textarea name="liabilityTerms" rows={3}/></label>
    <label>Reembolso / compensação<textarea name="reimbursementTerms" rows={3}/></label>
    <label>Observações<textarea name="notes" rows={2}/></label>
    <button className="primaryButton" disabled={busy}>Cadastrar acordo</button>
   </form>
  </section>

  <section style={{marginTop:24}}>
   <h2>Acordos cadastrados</h2>
   <div className="adminTableWrap"><table><thead><tr><th>Parceiro</th><th>Tipo</th><th>Status</th><th>Vigência</th><th>Recursos</th><th></th></tr></thead>
    <tbody>{items.map(x=><tr key={x.id}><td><strong>{x.partnerName}</strong><br/><small>{x.agreementReference??"Sem referência"}</small></td><td>{partnerLabels[x.partnerType]??x.partnerType}</td><td>{x.status}</td><td>{x.startsAt?new Date(x.startsAt+"T12:00:00").toLocaleDateString("pt-BR"):"—"} → {x.endsAt?new Date(x.endsAt+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td><td>{x.resourceCount}</td><td><button type="button" className="secondaryLink" onClick={()=>void open(x)}>Abrir</button></td></tr>)}</tbody>
   </table>{items.length===0&&<p>Nenhum acordo registrado.</p>}</div>
  </section>

  {selected&&<section style={{marginTop:28}}>
   <div className="listHeader"><div><h2>{selected.partnerName}</h2><p>{selected.capabilities?.join(" · ")||"Sem capacidades resumidas"}</p></div><button type="button" className="secondaryLink" onClick={()=>setSelected(null)}>Fechar</button></div>
   <section className="dataGrid">
    <article className="card"><h3>Contatos</h3>{selected.contacts?.length?selected.contacts.map((x,i)=><p key={i}>{x}</p>):<p>Não informado.</p>}</article>
    <article className="card"><h3>Responsabilidade</h3><p>{selected.liabilityTerms||"Não informada."}</p></article>
    <article className="card"><h3>Reembolso</h3><p>{selected.reimbursementTerms||"Não informado."}</p></article>
   </section>

   <h3>Recursos/capacidades mobilizáveis</h3>
   <div className="adminTableWrap"><table><thead><tr><th>Tipo</th><th>Recurso</th><th>Capacidade</th><th>Quantidade</th><th>Tempo de mobilização</th><th>Disponibilidade</th></tr></thead>
    <tbody>{resources.map(x=><tr key={x.id}><td>{resourceLabels[x.resourceType]??x.resourceType}</td><td>{x.resourceName}</td><td>{x.capabilityType??"—"}</td><td>{x.quantity??"—"} {x.unit??""}</td><td>{x.leadTimeMinutes!=null?x.leadTimeMinutes+" min":"—"}</td><td>{x.availabilityNotes??"—"}</td></tr>)}</tbody>
   </table>{resources.length===0&&<p>Nenhum recurso cadastrado neste acordo.</p>}</div>

   <form className="incidentForm compactForm" onSubmit={addResource}><h3>Adicionar recurso</h3>
    <div className="formGrid">
     <label>Tipo<select name="resourceType">{Object.keys(resourceLabels).map(x=><option key={x} value={x}>{resourceLabels[x]}</option>)}</select></label>
     <label>Nome do recurso<input name="resourceName" required/></label>
     <label>Tipificação/capacidade<input name="capabilityType" placeholder="Ex.: equipe de busca, retroescavadeira..."/></label>
     <label>Quantidade<input name="quantity" type="number" min="0" step="0.01"/></label>
     <label>Unidade<input name="unit"/></label>
     <label>Tempo para mobilização (min)<input name="leadTimeMinutes" type="number" min="0"/></label>
    </div>
    <label>Observações de disponibilidade<input name="availabilityNotes"/></label>
    <button className="primaryButton" disabled={busy}>Adicionar recurso</button>
   </form>
  </section>}
 </main>;
}
