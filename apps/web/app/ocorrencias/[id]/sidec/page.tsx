"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent,useCallback,useEffect,useMemo,useState } from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type ExportDocument={id:string;number?:string|null;title:string;documentType:string;revision:number;contentHash?:string|null};
type SidecExport={
 id:string;revision:number;schemaVersion:string;status:string;snapshotHash:string;manifestHash?:string|null;
 externalProtocol?:string|null;externalNotes?:string|null;exportedAt?:string|null;submittedAt?:string|null;
 acknowledgedAt?:string|null;rejectedAt?:string|null;createdAt:string;updatedAt:string;documents:ExportDocument[];artifactSealed:boolean;artifactHash?:string|null;manifestSignature?:string|null;signingKeyId?:string|null;artifactSignedAt?:string|null;retentionClass?:string|null;retainUntil?:string|null;legalHold?:boolean|null;retentionNotes?:string|null;
};
type Mapping={sourcePath:string;targetField:string;required:boolean;enabled:boolean;sortOrder:number};
type Check={code:string;label:string;required:boolean;ok:boolean;detail?:string};
type AvailableDocument={id:string;number?:string|null;title:string;documentType:string;revision:number;contentHash?:string|null;issuedAt:string};
type CobradeRequirement={sourcePath:string;label:string;required:boolean;enabled:boolean;sortOrder:number};
type DocumentRequirement={scopeType:"DEFAULT"|"COBRADE"|"INCIDENT_TYPE";scopeValue:string;documentType:"REPORT"|"OPINION"|"INTERDICTION"|"DECLARATION"|"FORM"|"OTHER";label:string;minCount:number;required:boolean;enabled:boolean};
type Readiness={ready:boolean;checks:Check[];mappings:Mapping[];cobradeCode?:string|null;typeCode?:string|null;cobradeRequirements:CobradeRequirement[];documentRequirements:DocumentRequirement[];requiredDocumentIds:string[];availableDocuments:AvailableDocument[];mappedFields:Record<string,unknown>};
type Diff={path:string;before:unknown;after:unknown};
type CompareResult={current:{id:string;revision:number};against:{id:string;revision:number}|null;category?:string;categories?:string[];count?:number;totalCount?:number;differences:Diff[]};

const statusLabels:Record<string,string>={
 READY:"Pronto para exportação",EXPORTED:"Exportado",SUBMITTED:"Protocolado no SIDEC",
 ACKNOWLEDGED:"Recebimento confirmado",REJECTED:"Rejeitado / devolvido",CANCELLED:"Cancelado"
};

function show(value:unknown){
 if(value===null||value===undefined)return "—";
 if(typeof value==="string")return value||"—";
 return JSON.stringify(value);
}

export default function SidecExportsPage(){
 const params=useParams<{id:string}>(),incidentId=params.id;
 const [items,setItems]=useState<SidecExport[]>([]);
 const [readiness,setReadiness]=useState<Readiness|null>(null);
 const [mappingRows,setMappingRows]=useState<Mapping[]>([]);
 const [cobradeRows,setCobradeRows]=useState<CobradeRequirement[]>([]);
 const [documentScope,setDocumentScope]=useState<"DEFAULT"|"COBRADE"|"INCIDENT_TYPE">("DEFAULT");
 const [documentRuleRows,setDocumentRuleRows]=useState<DocumentRequirement[]>([]);
 const [sourceOptions,setSourceOptions]=useState<string[]>([]);
 const [selectedDocuments,setSelectedDocuments]=useState<string[]>([]);
 const [comparisons,setComparisons]=useState<Record<string,CompareResult>>({});
 const [compareCategories,setCompareCategories]=useState<Record<string,string>>({});
 const [returnPayloads,setReturnPayloads]=useState<Record<string,string>>({});
 const [protocols,setProtocols]=useState<Record<string,string>>({});
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [message,setMessage]=useState("Carregando interoperabilidade...");
 const [busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const response=await fetch(`${API}${path}`,{credentials:"include",...init,headers:{"Content-Type":"application/json",...(init?.headers??{})}});
  if(response.status===401){location.href="/login";return null}
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
   const error=new Error(body.message??body.error??"Não foi possível concluir a operação.") as Error&{body?:any};
   error.body=body;throw error;
  }
  return body;
 },[]);

 const load=useCallback(async()=>{
  try{
   const [exportsBody,readinessBody,mappingBody]=await Promise.all([
    request(`/api/v1/incidents/${incidentId}/sidec-exports`),
    request(`/api/v1/incidents/${incidentId}/sidec-readiness`),
    request("/api/v1/sidec/mappings")
   ]);
   setItems(exportsBody?.items??[]);
   setReadiness(readinessBody??null);
   setMappingRows((mappingBody?.items??readinessBody?.mappings??[]).map((x:Mapping)=>({...x})));
   setSourceOptions(mappingBody?.sourceOptions??[]);
   setCobradeRows((readinessBody?.cobradeRequirements??[]).map((x:CobradeRequirement)=>({...x})));
   const nextScope:("DEFAULT"|"COBRADE"|"INCIDENT_TYPE")=readinessBody?.cobradeCode?"COBRADE":readinessBody?.typeCode?"INCIDENT_TYPE":"DEFAULT";
   const nextScopeValue=nextScope==="COBRADE"?readinessBody?.cobradeCode:nextScope==="INCIDENT_TYPE"?readinessBody?.typeCode:"*";
   setDocumentScope(nextScope);
   if(nextScopeValue){
    const rulesBody=await request(`/api/v1/sidec/document-requirements?scopeType=${nextScope}&scopeValue=${encodeURIComponent(String(nextScopeValue))}`);
    setDocumentRuleRows((rulesBody?.items??[]).map((x:DocumentRequirement)=>({...x})));
   }else setDocumentRuleRows([]);
   setSelectedDocuments(current=>{
    const valid=current.filter(id=>(readinessBody?.availableDocuments??[]).some((d:AvailableDocument)=>d.id===id));
    return [...new Set([...valid,...(readinessBody?.requiredDocumentIds??[])])];
   });
   setMessage("");
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar interoperabilidade SIDEC.");}
 },[incidentId,request]);

 useEffect(()=>{void load()},[load]);

 const failedRequired=useMemo(()=>readiness?.checks.filter(x=>x.required&&!x.ok)??[],[readiness]);

 async function generate(){
  setBusy(true);setMessage("");
  try{
   const body=await request(`/api/v1/incidents/${incidentId}/sidec-exports`,{
    method:"POST",body:JSON.stringify({documentIds:selectedDocuments})
   });
   setMessage(`Pacote SIDEC revisão ${body?.revision??""} gerado com schema ${body?.schemaVersion??"1.1"}.`);
   await load();
  }catch(error){
   const typed=error as Error&{body?:any};
   if(typed.body?.error==="NOT_READY")setMessage("Pacote não gerado: complete os campos obrigatórios indicados no checklist.");
   else if(typed.body?.error==="DOCUMENT_REQUIREMENTS_NOT_MET")setMessage("Pacote não gerado: selecione os documentos oficiais obrigatórios indicados.");
   else setMessage(error instanceof Error?error.message:"Falha ao gerar pacote SIDEC.");
   await load();
  }finally{setBusy(false)}
 }

 async function saveMappings(){
  setBusy(true);setMessage("");
  try{
   await request("/api/v1/sidec/mappings",{method:"PUT",body:JSON.stringify({items:mappingRows})});
   setMessage("Mapeamento SIGDEC → SIDEC salvo. O checklist foi recalculado.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao salvar mapeamento.");}
  finally{setBusy(false)}
 }

 function updateMapping(index:number,patch:Partial<Mapping>){
  setMappingRows(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
 }
 function disableMapping(index:number){setMappingRows(rows=>rows.map((row,i)=>i===index?{...row,enabled:false,required:false}:row))}
 function addMapping(){
  const used=new Set(mappingRows.map(x=>x.sourcePath));
  const source=sourceOptions.find(x=>!used.has(x))??sourceOptions[0]??"incident.summary";
  setMappingRows(rows=>[...rows,{sourcePath:source,targetField:`campo.${rows.length+1}`,required:false,enabled:true,sortOrder:(rows.length+1)*10}]);
 }

 async function saveCobradeRequirements(){
  if(!readiness?.cobradeCode){setMessage("A ocorrência ainda não possui código COBRADE.");return}
  setBusy(true);setMessage("");
  try{
   await request("/api/v1/sidec/cobrade-requirements",{method:"PUT",body:JSON.stringify({cobradeCode:readiness.cobradeCode,items:cobradeRows})});
   setMessage("Requisitos adicionais do COBRADE salvos. O checklist foi recalculado.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao salvar requisitos COBRADE.");}
  finally{setBusy(false)}
 }
 function updateCobradeRequirement(index:number,patch:Partial<CobradeRequirement>){
  setCobradeRows(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
 }
 function addCobradeRequirement(){
  const used=new Set(cobradeRows.map(x=>x.sourcePath));
  const source=sourceOptions.find(x=>!used.has(x))??sourceOptions[0]??"incident.description";
  setCobradeRows(rows=>[...rows,{sourcePath:source,label:"Novo requisito",required:true,enabled:true,sortOrder:(rows.length+1)*10}]);
 }
 function removeCobradeRequirement(index:number){setCobradeRows(rows=>rows.filter((_,i)=>i!==index))}

 async function changeDocumentScope(scope:"DEFAULT"|"COBRADE"|"INCIDENT_TYPE"){
  const scopeValue=scope==="COBRADE"?readiness?.cobradeCode:scope==="INCIDENT_TYPE"?readiness?.typeCode:"*";
  if(!scopeValue){setMessage("Este escopo não está disponível para a ocorrência.");return}
  setDocumentScope(scope);setBusy(true);setMessage("");
  try{
   const body=await request(`/api/v1/sidec/document-requirements?scopeType=${scope}&scopeValue=${encodeURIComponent(String(scopeValue))}`);
   setDocumentRuleRows((body?.items??[]).map((x:DocumentRequirement)=>({...x})));
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar regras documentais.");}
  finally{setBusy(false)}
 }
 function addDocumentRule(){
  const used=new Set(documentRuleRows.map(x=>x.documentType));
  const types=["REPORT","OPINION","INTERDICTION","DECLARATION","FORM","OTHER"] as const;
  const documentType=types.find(x=>!used.has(x))??"REPORT";
  const scopeValue=documentScope==="COBRADE"?String(readiness?.cobradeCode??""):documentScope==="INCIDENT_TYPE"?String(readiness?.typeCode??""):"*";
  setDocumentRuleRows(rows=>[...rows,{scopeType:documentScope,scopeValue,documentType,label:"Documento obrigatório",minCount:1,required:true,enabled:true}]);
 }
 function updateDocumentRule(index:number,patch:Partial<DocumentRequirement>){
  setDocumentRuleRows(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
 }
 function removeDocumentRule(index:number){setDocumentRuleRows(rows=>rows.filter((_,i)=>i!==index))}
 async function saveDocumentRules(){
  const scopeValue=documentScope==="COBRADE"?readiness?.cobradeCode:documentScope==="INCIDENT_TYPE"?readiness?.typeCode:"*";
  if(!scopeValue){setMessage("Escopo documental indisponível.");return}
  setBusy(true);setMessage("");
  try{
   await request("/api/v1/sidec/document-requirements",{method:"PUT",body:JSON.stringify({
    scopeType:documentScope,scopeValue,items:documentRuleRows.map(({documentType,label,minCount,required,enabled})=>({documentType,label,minCount,required,enabled}))
   })});
   setMessage("Requisitos documentais salvos. O checklist foi recalculado.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao salvar requisitos documentais.");}
  finally{setBusy(false)}
 }

 async function importStructuredReturn(item:SidecExport){
  const raw=returnPayloads[item.id]?.trim();
  if(!raw){setMessage("Cole ou gere o envelope de retorno estruturado.");return}
  let payload:unknown;
  try{payload=JSON.parse(raw)}catch{setMessage("O retorno estruturado não contém JSON válido.");return}
  setBusy(true);setMessage("");
  try{
   const body=await request(`/api/v1/sidec-exports/${item.id}/returns/import`,{method:"POST",body:JSON.stringify(payload)});
   setMessage(body?.imported===false?"Este retorno já havia sido importado.":"Retorno estruturado importado e situação do pacote atualizada.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao importar retorno estruturado.");}
  finally{setBusy(false)}
 }
 function fillReturnTemplate(item:SidecExport){
  setReturnPayloads(values=>({...values,[item.id]:JSON.stringify({
   schemaVersion:"sigdec-sidec-return/1.0",
   externalProtocol:item.externalProtocol??"",
   outcome:"ACKNOWLEDGED",
   receivedAt:new Date().toISOString(),
   sourceName:"SIDEC/SP",
   notes:""
  },null,2)}));
 }

 async function compare(item:SidecExport){
  setBusy(true);setMessage("");
  try{
   const category=compareCategories[item.id]??"all";
   const body=await request(`/api/v1/sidec-exports/${item.id}/compare?category=${encodeURIComponent(category)}`);
   setComparisons(current=>({...current,[item.id]:body}));
   if(!body?.against)setMessage("Esta é a primeira revisão; não há revisão anterior para comparar.");
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao comparar revisões.");}
  finally{setBusy(false)}
 }

 async function saveRetention(item:SidecExport,event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setMessage("");
  const form=new FormData(event.currentTarget);
  try{
   await request(`/api/v1/sidec-exports/${item.id}/retention`,{method:"PATCH",body:JSON.stringify({
    retentionClass:String(form.get("retentionClass")||"UNSPECIFIED"),
    retainUntil:String(form.get("retainUntil")||"")||null,
    legalHold:form.get("legalHold")==="on",
    notes:String(form.get("retentionNotes")||"")||null
   })});
   setMessage("Metadados de retenção atualizados sem alterar o ZIP selado.");
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao atualizar retenção.");}
  finally{setBusy(false)}
 }

 async function changeStatus(id:string,status:string){
  setBusy(true);setMessage("");
  try{
   await request(`/api/v1/sidec-exports/${id}/status`,{
    method:"PATCH",body:JSON.stringify({
     status,externalProtocol:protocols[id]?.trim()||undefined,externalNotes:notes[id]?.trim()||undefined
    })
   });
   setMessage("Situação do pacote SIDEC atualizada.");await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao atualizar pacote SIDEC.");}
  finally{setBusy(false)}
 }

 function downloadUrl(id:string,format:"json"|"csv"|"zip"){return `${API}/api/v1/sidec-exports/${id}/download?format=${format}`}
 function documentPdfUrl(id:string){return `${API}/api/v1/technical-documents/${id}/pdf`}

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">INTEROPERABILIDADE · SIDEC/SP · v1.17</span><h1>Pacotes da ocorrência</h1><p>Checklist por COBRADE, manifesto íntegro, ZIP documental, mapeamento e revisões para lançamento controlado no sistema estadual.</p></div>
   <div className="headerActions"><button className="primaryButton" disabled={busy||!readiness?.ready} type="button" onClick={()=>void generate()}>Gerar nova revisão</button><Link className="secondaryLink" href={`/ocorrencias/${incidentId}`}>Voltar à ocorrência</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}

  <section className={readiness?.ready?"infoCard":"warningCard"}>
   <strong>{readiness?.ready?"✓ Ocorrência pronta para gerar pacote":"⚠ Checklist de completude"}</strong>
   <div className="dataGrid" style={{marginTop:12}}>
    {(readiness?.checks??[]).map(check=><article className="card" key={check.code}><h2>{check.ok?"✓":"⚠"} {check.label}</h2><p>{check.required?"Obrigatório":"Recomendado"} · {check.ok?"Completo":"Pendente"}</p>{check.detail&&<small>{check.detail}</small>}</article>)}
   </div>
   {failedRequired.length>0&&<p><strong>Geração bloqueada:</strong> {failedRequired.length} requisito(s) obrigatório(s) pendente(s).</p>}
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">COBRADE</span><h2>Requisitos adicionais{readiness?.cobradeCode&&<> · {readiness.cobradeCode}</>}</h2><p>Regras municipais adicionais para este código. O SIGDEC não presume exigências oficiais estaduais.</p></div>
   {!readiness?.cobradeCode?<div className="infoCard">A ocorrência precisa ter um código COBRADE para configurar regras específicas.</div>:<>
    <div className="dataGrid">
     {cobradeRows.length===0?<div className="infoCard">Nenhum requisito adicional configurado para este COBRADE.</div>:cobradeRows.map((row,index)=><article className="card" key={row.sourcePath+"-"+index}>
      <label>Campo<select value={row.sourcePath} onChange={e=>updateCobradeRequirement(index,{sourcePath:e.target.value})}>{sourceOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
      <label>Rótulo<input value={row.label} onChange={e=>updateCobradeRequirement(index,{label:e.target.value})}/></label>
      <label>Ordem<input type="number" min="0" value={row.sortOrder} onChange={e=>updateCobradeRequirement(index,{sortOrder:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={row.enabled} onChange={e=>updateCobradeRequirement(index,{enabled:e.target.checked})}/> Ativo</label>
      <label><input type="checkbox" checked={row.required} onChange={e=>updateCobradeRequirement(index,{required:e.target.checked})}/> Obrigatório</label>
      <button className="secondaryLink" type="button" disabled={busy} onClick={()=>removeCobradeRequirement(index)}>Remover</button>
     </article>)}
    </div>
    <div className="headerActions" style={{marginTop:12}}><button className="secondaryLink" type="button" disabled={busy} onClick={addCobradeRequirement}>Adicionar requisito</button><button className="primaryButton" type="button" disabled={busy} onClick={()=>void saveCobradeRequirements()}>Salvar requisitos COBRADE</button></div>
   </>}
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">DOCUMENTOS OBRIGATÓRIOS</span><h2>Regras por perfil / COBRADE</h2><p>O checklist combina o padrão municipal, o tipo da ocorrência e o COBRADE; quando a mesma categoria aparece mais de uma vez, prevalece o maior mínimo exigido.</p></div>
   <div className="dataGrid">
    {(readiness?.documentRequirements??[]).length===0?<div className="infoCard">Nenhum documento obrigatório configurado para esta ocorrência.</div>:(readiness?.documentRequirements??[]).map(rule=><article className="card" key={rule.documentType}><h2>{rule.label}</h2><p><strong>{rule.documentType}</strong> · mínimo {rule.minCount} · {rule.required?"obrigatório":"recomendado"}</p></article>)}
   </div>
   <div className="incidentForm compactForm" style={{marginTop:12}}>
    <label>Editar escopo
     <select value={documentScope} onChange={e=>void changeDocumentScope(e.target.value as "DEFAULT"|"COBRADE"|"INCIDENT_TYPE")}>
      <option value="DEFAULT">Padrão municipal</option>
      {readiness?.cobradeCode&&<option value="COBRADE">COBRADE {readiness.cobradeCode}</option>}
      {readiness?.typeCode&&<option value="INCIDENT_TYPE">Tipo {readiness.typeCode}</option>}
     </select>
    </label>
    <div className="dataGrid">
     {documentRuleRows.length===0?<div className="infoCard">Nenhuma regra cadastrada neste escopo.</div>:documentRuleRows.map((row,index)=><article className="card" key={row.documentType+"-"+index}>
      <label>Tipo
       <select value={row.documentType} onChange={e=>updateDocumentRule(index,{documentType:e.target.value as DocumentRequirement["documentType"]})}>
        <option value="REPORT">Relatório</option><option value="OPINION">Parecer</option><option value="INTERDICTION">Interdição</option><option value="DECLARATION">Declaração</option><option value="FORM">Formulário</option><option value="OTHER">Outro</option>
       </select>
      </label>
      <label>Rótulo<input value={row.label} onChange={e=>updateDocumentRule(index,{label:e.target.value})}/></label>
      <label>Quantidade mínima<input type="number" min="1" max="20" value={row.minCount} onChange={e=>updateDocumentRule(index,{minCount:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={row.enabled} onChange={e=>updateDocumentRule(index,{enabled:e.target.checked})}/> Ativo</label>
      <label><input type="checkbox" checked={row.required} onChange={e=>updateDocumentRule(index,{required:e.target.checked})}/> Obrigatório</label>
      <button className="secondaryLink" type="button" disabled={busy} onClick={()=>removeDocumentRule(index)}>Remover</button>
     </article>)}
    </div>
    <div className="headerActions"><button className="secondaryLink" type="button" disabled={busy} onClick={addDocumentRule}>Adicionar regra</button><button className="primaryButton" type="button" disabled={busy} onClick={()=>void saveDocumentRules()}>Salvar regras documentais</button></div>
   </div>
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">DOCUMENTOS</span><h2>Documentos emitidos que acompanharão a revisão</h2></div>
   {(readiness?.availableDocuments??[]).length===0?<div className="infoCard">Nenhum documento técnico emitido está vinculado à ocorrência. Documentos são opcionais.</div>:
   <div className="dataGrid">{readiness?.availableDocuments.map(doc=><label className="card" key={doc.id} style={{cursor:"pointer"}}>
    <span><input type="checkbox" checked={selectedDocuments.includes(doc.id)} onChange={e=>setSelectedDocuments(ids=>e.target.checked?[...ids,doc.id]:ids.filter(id=>id!==doc.id))}/> Selecionar</span>
    <h2>{doc.number??"Sem número"} · {doc.title}</h2><p>{doc.documentType} · revisão {doc.revision} · emitido em {new Date(doc.issuedAt).toLocaleString("pt-BR")}</p>{readiness?.requiredDocumentIds?.includes(doc.id)&&<small>Selecionado automaticamente para cumprir requisito documental.</small>}
    <a className="secondaryLink" href={documentPdfUrl(doc.id)} target="_blank" rel="noreferrer">Abrir PDF oficial</a>
   </label>)}</div>}
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">MAPEAMENTO</span><h2>SIGDEC → SIDEC</h2><p>Somente caminhos permitidos pelo sistema podem ser mapeados; não há execução de scripts.</p></div>
   <div className="dataGrid">
    {mappingRows.sort((a,b)=>a.sortOrder-b.sortOrder).map((row,index)=><article className="card" key={`${row.targetField}-${index}`}>
     <label>Origem<select value={row.sourcePath} onChange={e=>updateMapping(index,{sourcePath:e.target.value})}>{sourceOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
     <label>Campo de destino<input value={row.targetField} onChange={e=>updateMapping(index,{targetField:e.target.value})}/></label>
     <label>Ordem<input type="number" min="0" value={row.sortOrder} onChange={e=>updateMapping(index,{sortOrder:Number(e.target.value)})}/></label>
     <label><input type="checkbox" checked={row.enabled} onChange={e=>updateMapping(index,{enabled:e.target.checked})}/> Ativo</label>
     <label><input type="checkbox" checked={row.required} onChange={e=>updateMapping(index,{required:e.target.checked})}/> Obrigatório no checklist</label>
     <button className="secondaryLink" type="button" disabled={busy} onClick={()=>disableMapping(index)}>Desativar</button>
    </article>)}
   </div>
   <div className="headerActions" style={{marginTop:12}}><button className="secondaryLink" type="button" disabled={busy} onClick={addMapping}>Adicionar campo</button><button className="primaryButton" type="button" disabled={busy||mappingRows.length===0} onClick={()=>void saveMappings()}>Salvar mapeamento</button></div>
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">CAMPOS MATERIALIZADOS</span><h2>Prévia do pacote</h2></div>
   <div className="dataGrid">{Object.entries(readiness?.mappedFields??{}).map(([key,value])=><article className="card" key={key}><h2>{key}</h2><p>{show(value)}</p></article>)}</div>
  </section>

  <section className="detailSection">
   <div><span className="eyebrow">HISTÓRICO</span><h2>Revisões geradas</h2></div>
   <div className="dataGrid">
   {items.length===0?<div className="infoCard">Nenhum pacote gerado para esta ocorrência.</div>:items.map(item=>
    <article className="card" key={item.id}>
     <h2>Revisão {item.revision}</h2>
     <p><strong>{statusLabels[item.status]??item.status}</strong> · schema {item.schemaVersion}</p>
     <p>Gerado em {new Date(item.createdAt).toLocaleString("pt-BR")}</p>
     <p style={{overflowWrap:"anywhere"}}><strong>Snapshot SHA-256:</strong> {item.snapshotHash}</p>{item.manifestHash&&<p style={{overflowWrap:"anywhere"}}><strong>Manifesto SHA-256:</strong> {item.manifestHash}</p>}
     {item.artifactSealed&&<><p style={{overflowWrap:"anywhere"}}><strong>ZIP selado SHA-256:</strong> {item.artifactHash}</p><p style={{overflowWrap:"anywhere"}}><strong>Assinatura interna HMAC-SHA256:</strong> {item.manifestSignature}</p><p><strong>Chave HMAC:</strong> {item.signingKeyId??"legacy-v1"}</p>{item.artifactSignedAt&&<p>Selado em {new Date(item.artifactSignedAt).toLocaleString("pt-BR")}</p>}<form className="incidentForm compactForm" style={{marginTop:10}} onSubmit={e=>void saveRetention(item,e)}><strong>Retenção do artefato</strong><label>Classe<select name="retentionClass" defaultValue={item.retentionClass??"UNSPECIFIED"}><option value="UNSPECIFIED">Não definida</option><option value="OPERATIONAL">Operacional</option><option value="ARCHIVAL">Arquivística</option><option value="LEGAL_HOLD">Preservação / legal hold</option></select></label><label>Reter até<input type="date" name="retainUntil" defaultValue={item.retainUntil?String(item.retainUntil).slice(0,10):""}/></label><label><input type="checkbox" name="legalHold" defaultChecked={Boolean(item.legalHold)}/> Legal hold</label><label>Observação<textarea name="retentionNotes" defaultValue={item.retentionNotes??""}/></label><button className="secondaryLink" disabled={busy}>Salvar retenção</button></form></>}{item.externalProtocol&&<p><strong>Protocolo externo:</strong> {item.externalProtocol}</p>}
     {item.externalNotes&&<p>{item.externalNotes}</p>}

     {item.documents?.length>0&&<div><strong>Documentos do pacote</strong><ul>{item.documents.map(doc=><li key={doc.id}><a href={documentPdfUrl(doc.id)} target="_blank" rel="noreferrer">{doc.number??"Documento"} · {doc.title} · R{doc.revision}</a></li>)}</ul></div>}

     <div className="headerActions">
      <a className="secondaryLink" href={downloadUrl(item.id,"json")}>Baixar JSON</a>
      <a className="secondaryLink" href={downloadUrl(item.id,"csv")}>Baixar CSV</a>
      <a className="primaryButton" href={downloadUrl(item.id,"zip")}>{item.artifactSealed?"Baixar ZIP selado":"Baixar prévia ZIP"}</a>
      <select aria-label="Categoria da comparação" value={compareCategories[item.id]??"all"} onChange={e=>setCompareCategories(values=>({...values,[item.id]:e.target.value}))}>
       <option value="all">Todas as diferenças</option><option value="incident">Ocorrência</option><option value="mappedFields">Campos mapeados</option><option value="documents">Documentos</option><option value="actions">Ações</option><option value="inspections">Vistorias</option><option value="supportRequests">Solicitações</option><option value="humanitarianDeliveries">Assistência</option><option value="timeline">Timeline</option><option value="municipality">Município</option><option value="other">Outros</option>
      </select>
      <button className="secondaryLink" disabled={busy||item.revision===1} type="button" onClick={()=>void compare(item)}>Comparar com anterior</button>
     </div>

     {comparisons[item.id]&&<div className="infoCard" style={{marginTop:10}}>
      <strong>{comparisons[item.id]?.against?`R${comparisons[item.id]?.against?.revision} → R${item.revision}: ${comparisons[item.id]?.count??0} alteração(ões)`:"Primeira revisão"}</strong>
      {(comparisons[item.id]?.differences??[]).slice(0,40).map((diff,index)=><div key={`${diff.path}-${index}`} style={{marginTop:8}}><code>{diff.path}</code><div><small>Antes: {show(diff.before)}</small></div><div><small>Depois: {show(diff.after)}</small></div></div>)}
     </div>}

     {item.status==="READY"&&<div className="headerActions" style={{marginTop:10}}><button className="primaryButton" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"EXPORTED")}>Marcar como exportado</button><button className="secondaryLink" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"CANCELLED")}>Cancelar</button></div>}

     {item.status==="EXPORTED"&&<form onSubmit={(event:FormEvent)=>{event.preventDefault();void changeStatus(item.id,"SUBMITTED")}} className="incidentForm compactForm" style={{marginTop:12}}>
      <label>Protocolo no SIDEC<input required value={protocols[item.id]??item.externalProtocol??""} onChange={e=>setProtocols(p=>({...p,[item.id]:e.target.value}))} placeholder="Número/protocolo externo"/></label>
      <label>Observação<textarea value={notes[item.id]??""} onChange={e=>setNotes(p=>({...p,[item.id]:e.target.value}))}/></label>
      <button className="primaryButton" disabled={busy}>Registrar protocolo e envio</button>
     </form>}

     {item.status==="SUBMITTED"&&<div className="incidentForm compactForm" style={{marginTop:12}}>
      <label>Observação do retorno<textarea value={notes[item.id]??item.externalNotes??""} onChange={e=>setNotes(p=>({...p,[item.id]:e.target.value}))}/></label>
      <div className="headerActions"><button className="primaryButton" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"ACKNOWLEDGED")}>Confirmar recebimento</button><button className="secondaryLink" disabled={busy} type="button" onClick={()=>void changeStatus(item.id,"REJECTED")}>Registrar rejeição/devolução</button></div>
      <hr/>
      <strong>Retorno estruturado SIGDEC</strong>
      <p><small>Envelope controlado pelo SIGDEC; não é apresentado como formato oficial do SIDEC/SP.</small></p>
      <textarea rows={10} value={returnPayloads[item.id]??""} onChange={e=>setReturnPayloads(values=>({...values,[item.id]:e.target.value}))} placeholder='{"schemaVersion":"sigdec-sidec-return/1.0",...}'/>
      <div className="headerActions"><button className="secondaryLink" disabled={busy} type="button" onClick={()=>fillReturnTemplate(item)}>Inserir modelo</button><button className="primaryButton" disabled={busy} type="button" onClick={()=>void importStructuredReturn(item)}>Importar retorno</button></div>
     </div>}
    </article>
   )}
   </div>
  </section>
 </main>;
}