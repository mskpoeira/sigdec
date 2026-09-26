"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Course={id:string;code:string;title:string;provider:string|null;category:string;workloadHours:number|null;validityMonths:number|null;mandatory:boolean;active:boolean;createdAt:string};
type Person={id:string;matricula:string|null;name:string;type:"USER"|"VOLUNTEER"};
type RecordItem={id:string;personType:string;completedAt:string;expiresAt:string|null;certificateNumber:string|null;certificateReference:string|null;notes:string|null;courseId:string;courseCode:string;courseTitle:string;category:string;mandatory:boolean;personName:string;matricula:string|null;status:"VALID"|"EXPIRING"|"EXPIRED"};

const catLabels:Record<string,string>={
 SIDEC:"SIDEC",S2ID:"S2ID",PLANCON:"PLANCON",SCO:"SCO",FIELD_INSPECTION:"Vistoria de campo",ALERTS:"Alertas",
 RADIO:"Radiocomunicação",FIRST_AID:"Primeiros socorros",FIRE:"Incêndio/estiagem",LOGISTICS:"Logística",HUMANITARIAN:"Assistência humanitária",OTHER:"Outros"
};

export default function CapacitacaoPage(){
 const[courses,setCourses]=useState<Course[]>([]);
 const[people,setPeople]=useState<Person[]>([]);
 const[records,setRecords]=useState<RecordItem[]>([]);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);
 const[personType,setPersonType]=useState<"USER"|"VOLUNTEER">("USER");

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");
  return body;
 },[]);

 const load=useCallback(async()=>{
  const [c,p,r]=await Promise.all([request("/api/v1/training/courses"),request("/api/v1/training/people"),request("/api/v1/training/records")]);
  setCourses(c.items??[]);setPeople(p.items??[]);setRecords(r.items??[]);
 },[request]);

 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar."))},[load]);
 const personOptions=useMemo(()=>people.filter(x=>x.type===personType),[people,personType]);
 const expiring=records.filter(x=>x.status!=="VALID").length;

 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load()}catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}finally{setBusy(false)}}

 async function createCourse(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),hours=String(d.get("workloadHours")??"").trim(),validity=String(d.get("validityMonths")??"").trim();
  await perform(async()=>{
   await request("/api/v1/training/courses",{method:"POST",body:JSON.stringify({
    code:String(d.get("code")??""),title:String(d.get("title")??""),provider:String(d.get("provider")??""),
    category:String(d.get("category")??"OTHER"),workloadHours:hours?Number(hours):undefined,
    validityMonths:validity?Number(validity):undefined,mandatory:d.get("mandatory")==="on"
   })});form.reset();setMessage("Curso/capacitação cadastrado.");
  });
 }

 async function createRecord(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),expires=String(d.get("expiresAt")??"");
  await perform(async()=>{
   await request("/api/v1/training/records",{method:"POST",body:JSON.stringify({
    courseId:String(d.get("courseId")??""),personType,personId:String(d.get("personId")??""),
    completedAt:String(d.get("completedAt")??""),expiresAt:expires||undefined,
    certificateNumber:String(d.get("certificateNumber")??""),certificateReference:String(d.get("certificateReference")??""),
    notes:String(d.get("notes")??"")
   })});form.reset();setMessage("Capacitação vinculada ao participante.");
  });
 }

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · CAPACITAÇÃO E CREDENCIAIS · {SIGDEC_VERSION_LABEL}</span><h1>Capacitação Operacional</h1>
    <p>Controle de cursos, certificados, validade e preparo de servidores e voluntários.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/resiliencia">Centro de Resiliência</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}
  <section className="dataGrid">
   <article className="card"><h2>Cursos ativos</h2><p className="adminNumber">{courses.filter(x=>x.active).length}</p></article>
   <article className={expiring>0?"warningCard":"card"}><h2>Vencidos/vencendo</h2><p className="adminNumber">{expiring}</p><p>até 30 dias</p></article>
   <article className="card"><h2>Registros de capacitação</h2><p className="adminNumber">{records.length}</p></article>
  </section>

  <section style={{marginTop:20}}>
   <h2>Cadastrar curso/certificação</h2>
   <form className="incidentForm compactForm" onSubmit={createCourse}>
    <div className="formGrid">
     <label>Código<input name="code" required placeholder="SIDEC-OPERADOR"/></label>
     <label>Título<input name="title" required/></label>
     <label>Instituição/fornecedor<input name="provider"/></label>
     <label>Categoria<select name="category">{Object.keys(catLabels).map(x=><option key={x} value={x}>{catLabels[x]}</option>)}</select></label>
     <label>Carga horária<input name="workloadHours" type="number" min="0" step="0.5"/></label>
     <label>Validade em meses<input name="validityMonths" type="number" min="1"/></label>
     <label><input name="mandatory" type="checkbox"/> Capacitação obrigatória</label>
    </div>
    <button className="primaryButton" disabled={busy}>Cadastrar curso</button>
   </form>
  </section>

  <section style={{marginTop:20}}>
   <h2>Registrar conclusão/certificado</h2>
   <form className="incidentForm compactForm" onSubmit={createRecord}>
    <div className="formGrid">
     <label>Curso<select name="courseId" required>{courses.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select></label>
     <label>Tipo de participante<select value={personType} onChange={e=>setPersonType(e.target.value as "USER"|"VOLUNTEER")}><option value="USER">Servidor/usuário</option><option value="VOLUNTEER">Voluntário</option></select></label>
     <label>Participante<select name="personId" required>{personOptions.map(x=><option key={x.id} value={x.id}>{x.matricula?x.matricula+" · ":""}{x.name}</option>)}</select></label>
     <label>Data de conclusão<input name="completedAt" type="date" required/></label>
     <label>Validade específica<input name="expiresAt" type="date"/></label>
     <label>Nº certificado<input name="certificateNumber"/></label>
     <label>Referência/link do certificado<input name="certificateReference"/></label>
    </div>
    <label>Observações<input name="notes"/></label>
    <button className="primaryButton" disabled={busy}>Registrar capacitação</button>
   </form>
  </section>

  <section style={{marginTop:24}}>
   <h2>Matriz de capacitação</h2>
   <div className="adminTableWrap"><table><thead><tr><th>Participante</th><th>Curso</th><th>Conclusão</th><th>Validade</th><th>Status</th><th>Certificado</th></tr></thead>
    <tbody>{records.map(x=><tr key={x.id}><td><strong>{x.personName}</strong>{x.matricula&&<><br/><small>matrícula {x.matricula}</small></>}</td><td>{x.courseCode} · {x.courseTitle}{x.mandatory&&<><br/><small>obrigatório</small></>}</td><td>{new Date(x.completedAt+"T12:00:00").toLocaleDateString("pt-BR")}</td><td>{x.expiresAt?new Date(x.expiresAt+"T12:00:00").toLocaleDateString("pt-BR"):"Sem validade"}</td><td>{x.status==="VALID"?"✓ Válido":x.status==="EXPIRING"?"⚠ Vence em breve":"⚠ Vencido"}</td><td>{x.certificateNumber??"—"}{x.certificateReference&&<><br/><small>{x.certificateReference}</small></>}</td></tr>)}</tbody>
   </table>{records.length===0&&<p>Nenhuma capacitação registrada.</p>}</div>
  </section>
 </main>;
}
