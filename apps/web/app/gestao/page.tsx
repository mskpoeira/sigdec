"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Summary={activeRisks:number;openAlerts:number;s2idRecords:number;trainings:number;recoveryActions:number};
export default function GestaoPage(){
 const [data,setData]=useState<Summary|null>(null); const [error,setError]=useState("");
 useEffect(()=>{fetch(`${API}/api/v1/management/summary`,{credentials:"include"}).then(async r=>{if(r.status===401){location.href="/login";return null}if(!r.ok)throw new Error("Sem permissão ou serviço indisponível.");return r.json()}).then(v=>v&&setData(v)).catch(e=>setError(e.message))},[]);
 const cards=data?[["Riscos ativos",data.activeRisks],["Alertas abertos",data.openAlerts],["Registros S2iD",data.s2idRecords],["Treinamentos",data.trainings],["Ações de recuperação",data.recoveryActions]]:[];
 return <main className="shell moduleShell"><header className="listHeader"><div><span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span><h1>Planejamento, risco e recuperação</h1><p>Riscos, alertas, S2iD, treinamento, recuperação, integrações e inteligência assistiva.</p></div><Link className="secondaryLink" href="/painel">Voltar</Link></header>
 {error&&<p className="errorMessage">{error}</p>}<section className="dataGrid">{cards.map(([n,v])=><article className="card" key={String(n)}><h2>{n}</h2><p style={{fontSize:"2rem",fontWeight:900}}>{v}</p></article>)}</section>
 <section className="grid" style={{marginTop:18}}>
 {["Riscos e mitigação","Alertas e protocolos","S2iD · COBRADE · FIDE · DMATE","Treinamentos · Simulados · AAR","Recuperação pós-desastre","Biblioteca institucional","Relatórios e BI","Integrações e webhooks","Feature flags e administração","Inteligência assistiva"].map(x=><article className="card" key={x}><h2>{x}</h2><p>Módulo estruturado no núcleo v1.0 e controlado por permissão.</p></article>)}
 </section></main>
}