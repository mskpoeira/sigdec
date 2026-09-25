"use client";
import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";
const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Volunteer={id:string;fullName:string;phone?:string|null;email?:string|null;status:string;availability?:string|null;
 shirtSize?:string|null;pantsSize?:string|null;jacketSize?:string|null;raincoatSize?:string|null;vestSize?:string|null;gloveSize?:string|null;shoeSize?:string|null;
 profession?:string|null;education?:string|null;institution?:string|null;cnhCategory?:string|null;languages?:string[];radioamateurCallSign?:string|null;
 operationRegion?:string|null;skills?:string[];validatedSkills?:string[];notes?:string|null};

export default function Page(){
 const [items,setItems]=useState<Volunteer[]>([]),[status,setStatus]=useState("Carregando..."),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(()=>fetch(`${API}/api/v1/volunteers`,{credentials:"include"}).then(async r=>{if(r.status===401){location.href="/login";return null}if(!r.ok)throw new Error();return r.json()}).then(b=>{if(b){setItems(b.items??[]);setStatus("")}}).catch(()=>setStatus("Não foi possível carregar os dados.")),[]);
 useEffect(()=>{void load()},[load]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setMessage("");const f=new FormData(e.currentTarget);
  const csv=(name:string)=>String(f.get(name)||"").split(",").map(x=>x.trim()).filter(Boolean);
  const val=(name:string)=>String(f.get(name)||"").trim()||undefined;
  const body={fullName:val("fullName"),phone:val("phone"),email:val("email"),availability:val("availability"),
   shirtSize:val("shirtSize"),pantsSize:val("pantsSize"),jacketSize:val("jacketSize"),raincoatSize:val("raincoatSize"),
   vestSize:val("vestSize"),gloveSize:val("gloveSize"),shoeSize:val("shoeSize"),profession:val("profession"),
   education:val("education"),institution:val("institution"),cnhCategory:val("cnhCategory"),languages:csv("languages"),
   radioamateurCallSign:val("radioamateurCallSign"),operationRegion:val("operationRegion"),skills:csv("skills"),
   validatedSkills:[],certifications:[],history:[],notes:val("notes")};
  const r=await fetch(`${API}/api/v1/volunteers`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  setBusy(false);if(!r.ok){const b=await r.json().catch(()=>({}));setMessage(b.message??"Não foi possível cadastrar o voluntário.");return}
  e.currentTarget.reset();setMessage("Voluntário cadastrado.");await load();
 }
 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">SIGDEC · VOLUNTARIADO · v1.39</span><h1>Voluntariado</h1><p>Cadastro operacional, competências, disponibilidade, vestuário e EPI para mobilização.</p></div><div className="headerActions"><Link className="secondaryLink" href="/painel">Painel</Link></div></header>
  <section className="operationsGrid">
   <form className="incidentForm compactForm" onSubmit={submit}>
    <h2>Cadastrar voluntário</h2>
    <label>Nome completo<input name="fullName" required/></label>
    <div className="formGrid"><label>Telefone<input name="phone"/></label><label>E-mail<input name="email" type="email"/></label></div>
    <div className="formGrid"><label>Profissão<input name="profession"/></label><label>Formação<input name="education"/></label><label>Instituição<input name="institution"/></label><label>CNH<input name="cnhCategory"/></label></div>
    <div className="formGrid"><label>Idiomas, separados por vírgula<input name="languages"/></label><label>Indicativo de radioamador<input name="radioamateurCallSign"/></label><label>Região de atuação<input name="operationRegion"/></label><label>Disponibilidade<input name="availability"/></label></div>
    <h3>Vestuário e mobilização</h3>
    <div className="formGrid"><label>Camiseta<input name="shirtSize"/></label><label>Calça<input name="pantsSize"/></label><label>Jaqueta<input name="jacketSize"/></label><label>Capa de chuva<input name="raincoatSize"/></label><label>Colete<input name="vestSize"/></label><label>Luva<input name="gloveSize"/></label><label>Calçado / bota<input name="shoeSize"/></label></div>
    <label>Competências declaradas<input name="skills" placeholder="primeiros socorros, rádio, motosserra"/></label>
    <label>Observações<textarea name="notes"/></label>
    {message&&<p className="formMessage">{message}</p>}<button className="primaryButton" disabled={busy}>{busy?"Salvando...":"Cadastrar voluntário"}</button>
   </form>
   <section className="dataGrid">{status&&<div className="infoCard">{status}</div>}{items.length===0&&!status?<div className="infoCard">Nenhum registro cadastrado.</div>:items.map(x=><article className="card" key={x.id}>
    <h2>{x.fullName}</h2><p><strong>{x.status}</strong>{x.profession?` · ${x.profession}`:""}{x.operationRegion?` · ${x.operationRegion}`:""}</p>
    <p>{x.phone??"Sem telefone"}{x.email?` · ${x.email}`:""}</p>
    <p><strong>Vestuário:</strong> camiseta {x.shirtSize??"—"} · calça {x.pantsSize??"—"} · jaqueta {x.jacketSize??"—"} · capa {x.raincoatSize??"—"} · colete {x.vestSize??"—"} · luva {x.gloveSize??"—"} · calçado {x.shoeSize??"—"}</p>
    <p><strong>Competências:</strong> {(x.skills??[]).join(", ")||"não informadas"}{(x.validatedSkills??[]).length?` · validadas: ${x.validatedSkills?.join(", ")}`:""}</p>
    {x.languages?.length?<p>Idiomas: {x.languages.join(", ")}</p>:null}{x.radioamateurCallSign?<p>Radioamador: {x.radioamateurCallSign}</p>:null}
   </article>)}</section>
  </section>
 </main>;
}