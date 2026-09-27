"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {useRealtimeRefresh} from "../../lib/use-realtime-refresh";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type ProviderStatus={code:string;label:string;configured:boolean;model:string;purpose:string};
type Status={enabled:boolean;providers:ProviderStatus[];policy:{mode:string;humanDecisionRequired:boolean;systemMutationAllowed:boolean;credentialDiscoveryAllowed:boolean;thirdPartyAccessAllowed:boolean}};

const externalTools=[
 {code:"CHATGPT",name:"ChatGPT",url:"https://chatgpt.com/",icon:"◉",purpose:"Revisão de texto, brainstorming, explicações e segunda leitura geral.",note:"Acesso externo. O SIGDEC não envia dados, sessão ou credenciais automaticamente."},
 {code:"GEMINI_WEB",name:"Gemini",url:"https://gemini.google.com/app",icon:"✦",purpose:"Análise multimodal geral, comparação de alternativas e apoio à compreensão de conteúdo.",note:"Acesso externo. Use somente dados que você esteja autorizado a compartilhar."},
 {code:"AI_STUDIO",name:"Google AI Studio",url:"https://aistudio.google.com/apps",icon:"◇",purpose:"Experimentação de prompts/modelos e obtenção/configuração de chave da Gemini API pelo administrador.",note:"Ambiente externo de desenvolvimento; não recebe segredos do SIGDEC automaticamente."},
 {code:"GROQ",name:"Groq Playground",url:"https://console.groq.com/playground",icon:"⚡",purpose:"Análise rápida e comparação de modelos abertos; pode atuar como provedor opcional do assistente contextual.",note:"Plano/limites externos podem mudar. API somente com chave configurada no servidor."},
 {code:"HF",name:"Hugging Face Inference Playground",url:"https://huggingface.co/spaces/huggingface/inference-playground",icon:"🤗",purpose:"Comparar modelos abertos e experimentar tarefas de inferência fora do SIGDEC.",note:"Ferramenta externa; nenhuma transferência automática de dados do sistema."}
] as const;

export default function AiProvidersPage(){
 const[status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState("");
 const load=useCallback(async()=>{try{const r=await fetch(API+"/api/v1/ai/providers",{credentials:"include",cache:"no-store"});if(r.status===401){location.href="/login";return}if(!r.ok)throw new Error("Falha ao consultar provedores.");setStatus(await r.json());setMessage("")}catch(e){setMessage(e instanceof Error?e.message:"Falha ao carregar provedores.")}},[]);
 useEffect(()=>{void load()},[load]);
 useRealtimeRefresh(()=>load(),true,30000);
 return <main className="shell moduleShell">
  <header className="listHeader"><div><span className="eyebrow">INTELIGÊNCIA SIGDEC · PROVEDORES · {SIGDEC_VERSION_LABEL}</span><h1>Central de IA</h1><p>Provedores internos opcionais e atalhos externos verificados, cada um com função definida e sem autonomia para alterar o SIGDEC.</p></div><div className="headerActions"><Link className="secondaryLink" href="/inteligencia">Inteligência</Link><Link className="secondaryLink" href="/painel">Painel</Link></div></header>
  <section className="warningCard"><strong>Regra de governança</strong><p>Toda IA é consultiva. A decisão final é sempre humana. A IA incorporada não pode alterar dados, configurações, usuários, perfis, permissões, código ou integrações; não pode descobrir ou solicitar senhas, tokens, sessões, chaves ou segredos; e não pode obter acesso a contas ou dados de terceiros.</p></section>
  {message&&<section className="infoCard">{message}</section>}
  <section style={{marginTop:18}}><h2>Provedores disponíveis dentro do SIGDEC</h2><p>Somente o servidor conhece se uma chave está configurada. Nenhuma chave é exibida nesta tela.</p><div className="dataGrid">{(status?.providers??[]).map(p=><article className={p.configured?"card":"warningCard"} key={p.code}><span className="eyebrow">{p.code}</span><h2>{p.label}</h2><p>{p.purpose}</p><p><strong>{p.configured?"Configurado":"Não configurado"}</strong> · modelo {p.model}</p><small>{p.configured?"Pode ser usado pelo assistente contextual conforme a ordem segura do servidor.":"Permanece inativo até o administrador configurar a chave no servidor."}</small></article>)}</div></section>
  <section style={{marginTop:24}}><h2>Ferramentas externas</h2><p>Estes links abrem em nova aba. O SIGDEC não compartilha automaticamente prontuários, ocorrências, senhas, cookies, sessão ou qualquer outro dado com esses sites.</p><div className="dataGrid">{externalTools.map(tool=><article className="card" key={tool.code}><span className="eyebrow">{tool.icon} {tool.code}</span><h2>{tool.name}</h2><p>{tool.purpose}</p><p><small>{tool.note}</small></p><a className="primaryButton" href={tool.url} target="_blank" rel="noopener noreferrer">Abrir {tool.name} ↗</a></article>)}</div></section>
  <section className="infoCard" style={{marginTop:24}}><strong>Privacidade e uso responsável</strong><p>Ao abrir uma ferramenta externa, você sai do ambiente SIGDEC e passa a estar sujeito aos termos e políticas do respectivo provedor. Não cole credenciais, tokens, senhas, dados pessoais desnecessários ou documentos sigilosos. Para análises do próprio SIGDEC, prefira o assistente contextual interno, que envia somente contexto minimizado e autorizado quando um provedor de API estiver configurado.</p></section>
 </main>;
}
