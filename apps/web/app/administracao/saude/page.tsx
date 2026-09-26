"use client";

import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {formatDateTimeBR} from "../../lib/datetime";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Health={
 status:string;
 version:string;
 environment:string;
 serverTime:string;
 uptimeSeconds:number;
 nodeVersion:string;
 database:{status:string;latencyMs:number;time:string|null;postgresVersion:string|null;postgisVersion:string|null};
 migrations:{count:number;lastFilename:string|null;lastAppliedAt:string|null};
 integrations:{active:number;pending:number;failed:number};
 audit24h:{total:number;mutations:number};
 auditIntegrity:{total:number;unsealed:number;invalid:number;appendOnly:boolean;algorithm:string};
 auditCheckpoints:{total:number;latestAt:string|null;latestHash:string|null};
};

const duration=(seconds:number)=>{
 const days=Math.floor(seconds/86400),hours=Math.floor((seconds%86400)/3600),minutes=Math.floor((seconds%3600)/60);
 return [days?`${days}d`:"",hours?`${hours}h`:"",`${minutes}min`].filter(Boolean).join(" ");
};

export default function SystemHealthPage(){
 const[data,setData]=useState<Health|null>(null);
 const[message,setMessage]=useState("Carregando diagnóstico...");
 const[busy,setBusy]=useState(false);

 const load=useCallback(async()=>{
  setBusy(true);
  try{
   const response=await fetch(`${API}/api/v1/admin/system-health`,{credentials:"include",cache:"no-store"});
   if(response.status===401){location.href="/login";return}
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.message??body.error??"Não foi possível consultar a saúde do sistema.");
   setData(body);setMessage("");
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao consultar a saúde do sistema.");}
  finally{setBusy(false);}
 },[]);

 useEffect(()=>{void load()},[load]);

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · SAÚDE DO SISTEMA · {SIGDEC_VERSION_LABEL}</span><h1>Saúde e diagnóstico</h1>
    <p>Visão operacional do ambiente, banco de dados, migrações, integrações e auditoria.</p></div>
   <div className="headerActions"><button className="primaryButton" disabled={busy} onClick={()=>void load()}>{busy?"Atualizando...":"Atualizar"}</button><Link className="secondaryLink" href="/administracao">Administração</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}

  {data&&<>
   <section className="dataGrid">
    <article className={data.status==="ok"?"card":"warningCard"}><h2>Aplicação</h2><p className="adminNumber">{data.status==="ok"?"OK":"ATENÇÃO"}</p><p>API {data.version} · {data.environment}</p><p>Node {data.nodeVersion}</p></article>
    <article className={data.database.status==="ok"?"card":"warningCard"}><h2>Banco de dados</h2><p className="adminNumber">{data.database.latencyMs} ms</p><p>PostgreSQL {data.database.postgresVersion??"—"}</p><p>PostGIS {data.database.postgisVersion??"—"}</p></article>
    <article className="card"><h2>Tempo ativo</h2><p className="adminNumber">{duration(data.uptimeSeconds)}</p><p>Servidor: {formatDateTimeBR(data.serverTime)}</p><p>Banco: {formatDateTimeBR(data.database.time)}</p></article>
    <article className="card"><h2>Migrações</h2><p className="adminNumber">{data.migrations.count}</p><p>{data.migrations.lastFilename??"Nenhuma migração"}</p><p>{data.migrations.lastAppliedAt?formatDateTimeBR(data.migrations.lastAppliedAt):"—"}</p></article>
    <article className={data.integrations.failed>0?"warningCard":"card"}><h2>Integrações</h2><p className="adminNumber">{data.integrations.active}</p><p>{data.integrations.pending} pendente(s) · {data.integrations.failed} falha(s)</p></article>
    <article className="card"><h2>Auditoria · 24h</h2><p className="adminNumber">{data.audit24h.total}</p><p>{data.audit24h.mutations} alteração(ões) autenticada(s)</p><Link className="secondaryLink" href="/administracao/auditoria">Abrir Registro de Atividades</Link></article>
    <article className={data.auditIntegrity.invalid===0&&data.auditIntegrity.unsealed===0?"card":"warningCard"}><h2>Integridade da auditoria</h2><p className="adminNumber">{data.auditIntegrity.invalid===0&&data.auditIntegrity.unsealed===0?"OK":"ATENÇÃO"}</p><p>{data.auditIntegrity.total} registro(s) · {data.auditIntegrity.invalid} inválido(s) · {data.auditIntegrity.unsealed} sem selo</p><p>{data.auditIntegrity.algorithm} · {data.auditIntegrity.appendOnly?"append-only":"alterável"}</p></article>
    <article className="card"><h2>Checkpoints da auditoria</h2><p className="adminNumber">{data.auditCheckpoints.total}</p><p>{data.auditCheckpoints.latestAt?`Último em ${formatDateTimeBR(data.auditCheckpoints.latestAt)}`:"Nenhum checkpoint criado"}</p>{data.auditCheckpoints.latestHash&&<p><code title={data.auditCheckpoints.latestHash}>{data.auditCheckpoints.latestHash.slice(0,18)}…</code></p>}<Link className="secondaryLink" href="/administracao/auditoria">Gerenciar checkpoints</Link></article>
   </section>
   <section className="infoCard" style={{marginTop:18}}>
    <strong>Leitura do ambiente</strong>
    <p>Versão do frontend: {SIGDEC_VERSION_LABEL} · versão informada pela API: v{data.version}. O diagnóstico é somente leitura e não altera configurações.</p>
   </section>
  </>}
 </main>;
}
