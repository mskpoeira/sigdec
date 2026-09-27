"use client";

import {FormEvent,useEffect,useMemo,useRef,useState} from "react";
import {usePathname} from "next/navigation";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
const hiddenPrefixes=["/login","/esqueci-senha","/redefinir-senha","/alterar-senha","/integridade","/verificar-integridade","/offline"];
const presets:Array<[RegExp,string,string[]]>= [
 [/^\/ocorrencias/,"Ocorrências",["Resuma a situação desta tela e aponte dados que merecem conferência.","Quais próximos passos operacionais devo considerar?"]],
 [/^\/monitoramento|^\/campo|^\/alertas/,"Monitoramento",["Analise o contexto de monitoramento e destaque sinais que exigem atenção.","Sugira o que conferir antes de emitir um alerta."]],
 [/^\/assistencia/,"Assistência Humanitária",["Aponte pendências de cadastro e acompanhamento que devo conferir.","Sugira um checklist de atendimento humanitário para esta situação."]],
 [/^\/planejamento|^\/gestao-riscos/,"PLANCON e Risco",["Quais pontos do PLANCON ou da gestão do risco devo revisar aqui?","Organize um checklist preventivo para este módulo."]],
 [/^\/gestao|^\/sco/,"Centro de Gestão / SCO",["Organize as prioridades operacionais deste módulo.","Que informações faltantes podem prejudicar a consciência situacional?"]],
 [/^\/documentos|^\/inteligencia/,"Inteligência e Documentos",["Ajude a estruturar uma análise técnica com os dados disponíveis.","Quais validações humanas e documentais são necessárias antes de concluir?"]],
 [/^\/administracao/,"Administração",["Faça um checklist de governança e configuração desta área.","Quais riscos de configuração devo verificar antes da produção?"]],
 [/^\/resiliencia|^\/voluntarios|^\/capacitacao/,"Resiliência",["Sugira prioridades de preparação e resiliência para este módulo.","Que cadastros e capacidades devo manter atualizados?"]]
];

export default function SigdecAiAssistant(){
 const pathname=usePathname(),[open,setOpen]=useState(false),[question,setQuestion]=useState(""),[answer,setAnswer]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const endRef=useRef<HTMLDivElement|null>(null);
 const hidden=pathname==="/"||hiddenPrefixes.some(x=>pathname.startsWith(x));
 const preset=useMemo(()=>presets.find(([r])=>r.test(pathname))??[/.*/,"SIGDEC",["Analise esta área e indique o que merece atenção.","Que próximos passos você sugere para esta tela?"]] as [RegExp,string,string[]],[pathname]);
 useEffect(()=>{setAnswer("");setError("");setQuestion("")},[pathname]);
 useEffect(()=>{if(open)endRef.current?.scrollIntoView({block:"nearest"})},[open,answer]);
 async function ask(e?:FormEvent){e?.preventDefault();const q=question.trim();if(!q||busy)return;setBusy(true);setError("");try{
  const r=await fetch(API+"/api/v1/ai/contextual-assist",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({route:pathname,question:q})});
  const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message??b.error??"Não foi possível consultar a Inteligência SIGDEC.");
  setAnswer(b.answer??"Sem resposta.");setQuestion("");
 }catch(err){setError(err instanceof Error?err.message:"Falha na Inteligência SIGDEC.")}finally{setBusy(false)}}
 if(hidden)return null;
 return <>
  <button type="button" className="sigdecAiLauncher" onClick={()=>setOpen(v=>!v)} aria-label="Abrir Inteligência SIGDEC"><span>✦</span><strong>IA SIGDEC</strong></button>
  {open&&<aside className="sigdecAiPanel" aria-label="Assistente contextual SIGDEC">
   <header><div><span>✦ INTELIGÊNCIA SIGDEC</span><strong>{preset[1]}</strong></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fechar">×</button></header>
   <div className="sigdecAiBody">
    <p className="sigdecAiNotice">Assistente contextual desta tela. Confirme fatos, legislação, medições e decisões operacionais antes de agir.</p>
    {!answer&&<div className="sigdecAiPresets">{preset[2].map(p=><button key={p} type="button" onClick={()=>setQuestion(p)}>{p}</button>)}</div>}
    {answer&&<div className="sigdecAiAnswer">{answer}</div>}
    {error&&<div className="sigdecAiError">{error}</div>}
    <div ref={endRef}/>
   </div>
   <form onSubmit={ask}><textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder={"Pergunte à IA sobre "+preset[1].toLowerCase()+"..."} maxLength={4000}/><button type="submit" disabled={busy||!question.trim()}>{busy?"Analisando...":"Enviar"}</button></form>
  </aside>}
 </>;
}
