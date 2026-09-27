import type {FastifyInstance,FastifyRequest} from "fastify";
import {createHash} from "node:crypto";
import {z} from "zod";
import {authFrom,requireAuth,requirePermission} from "../auth.js";
import {db} from "../db.js";
import {generateContextualAnswer,generateTechnicalDraft} from "../lib/ai-assist.js";

const uuid=z.string().uuid();
const normInput=z.object({
 jurisdiction:z.enum(["FEDERAL","STATE","MUNICIPAL"]),stateCode:z.string().trim().max(2).optional().default(""),
 municipality:z.string().trim().max(160).optional().default(""),normType:z.string().trim().min(2).max(80),
 normNumber:z.string().trim().min(1).max(80),normYear:z.number().int().min(1800).max(2200).optional(),
 title:z.string().trim().min(3).max(1000),summary:z.string().trim().max(12000).optional().default(""),
 status:z.enum(["ACTIVE","REVOKED","SUPERSEDED","DRAFT"]).default("ACTIVE"),sourceUrl:z.string().url().max(3000),
 officialSource:z.string().trim().min(2).max(240),topics:z.array(z.string().trim().min(1).max(80)).max(100).default([]),
 fullText:z.string().max(2000000).optional().default(""),verificationNotes:z.string().trim().max(8000).optional().default("")
});
const generateInput=z.object({
 incidentId:z.string().uuid(),
 reportType:z.enum(["FIELD_INSPECTION","RISK_ASSESSMENT","EMERGENCY","DAMAGE","INTERDICTION","SITREP","GENERAL"]).default("FIELD_INSPECTION"),
 title:z.string().trim().min(3).max(500).optional(),additionalInstructions:z.string().trim().max(5000).optional().default("")
});
const reviewInput=z.object({status:z.enum(["IN_REVIEW","APPROVED","REJECTED","ARCHIVED"]),draftText:z.string().min(20).max(200000).optional(),reviewNotes:z.string().trim().max(8000).optional().default("")});
const contextualAssistInput=z.object({route:z.string().trim().min(1).max(500).regex(/^\//),question:z.string().trim().min(2).max(4000)});
function contextualModule(route:string){
 if(route.startsWith("/ocorrencias"))return "Ocorrências";
 if(route.startsWith("/monitoramento")||route.startsWith("/campo")||route.startsWith("/alertas"))return "Monitoramento e Alertas";
 if(route.startsWith("/assistencia"))return "Assistência Humanitária";
 if(route.startsWith("/planejamento")||route.startsWith("/gestao-riscos"))return "PLANCON e Gestão do Risco";
 if(route.startsWith("/gestao")||route.startsWith("/sco"))return "Centro de Gestão / SCO";
 if(route.startsWith("/documentos")||route.startsWith("/inteligencia"))return "Inteligência e Documentos";
 if(route.startsWith("/administracao"))return "Administração";
 if(route.startsWith("/resiliencia")||route.startsWith("/voluntarios")||route.startsWith("/capacitacao"))return "Resiliência e Preparação";
 return "SIGDEC";
}

function organizationId(request:FastifyRequest){
 const value=authFrom(request).organizationId;if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return value;
}
function sha(value:string){return createHash("sha256").update(value).digest("hex")}
function topic(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")}
function inferTopics(item:any){
 const text=[item.typeName,item.summary,item.description,item.addressLine,item.neighborhood].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const out=new Set<string>(["defesa_civil","risco","desastre"]);
 const add=(...values:string[])=>values.forEach(v=>out.add(v));
 if(/obra|edific|constr|muro|lote|parcel|ocup|imovel|moradia|habit/.test(text))add("urbanismo","uso_solo","parcelamento","habitacao","ocupacao");
 if(/encosta|desliz|talude|eros|movimento de massa/.test(text))add("urbanismo","meio_ambiente","ocupacao");
 if(/alag|inund|enchente|drenag|rio|corrego/.test(text))add("drenagem","saneamento","meio_ambiente");
 if(/arvore|veget|mata|app|ambient|desmat|nascente/.test(text))add("meio_ambiente","app","vegetacao");
 if(/esgoto|saneamento|agua/.test(text))add("saneamento","infraestrutura","meio_ambiente");
 if(/ponte|via|estrada|rodovia|energia|eletric|telecom|hospital|escola/.test(text))add("infraestrutura");
 if(/abrigo|desaloj|desabrig|evacua/.test(text))add("abrigos","evacuacao","habitacao");
 if(/contrat|emergencial|compra|servico/.test(text))add("contratacao","emergencia");
 return [...out];
}
async function loadIncident(org:string,id:string){
 const r=await db.query("SELECT i.id,i.protocol,i.status,i.priority,i.risk_to_life AS \"riskToLife\",i.summary,i.description,i.source,i.address_line AS \"addressLine\",i.neighborhood,i.reference_point AS \"referencePoint\",i.latitude,i.longitude,i.created_at AS \"createdAt\",i.updated_at AS \"updatedAt\",t.code AS \"typeCode\",t.name AS \"typeName\",t.group_name AS \"groupName\" FROM incidents i JOIN incident_types t ON t.id=i.incident_type_id WHERE i.id=$1 AND i.organization_id=$2",[id,org]);
 return r.rows[0];
}
async function legalContext(org:string,incident:any){
 const topics=inferTopics(incident);
 const r=await db.query("SELECT id,jurisdiction,state_code AS \"stateCode\",municipality,norm_type AS \"normType\",norm_number AS \"normNumber\",norm_year AS \"normYear\",title,summary,status,source_url AS \"sourceUrl\",official_source AS \"officialSource\",topics,verified_at AS \"verifiedAt\",verification_notes AS \"verificationNotes\" FROM legal_norms WHERE status='ACTIVE' AND (organization_id IS NULL OR organization_id=$1) AND (jurisdiction='FEDERAL' OR jurisdiction='STATE' AND state_code='SP' OR jurisdiction='MUNICIPAL' AND lower(COALESCE(municipality,''))='ubatuba') AND (topics ?| $2::text[] OR jurisdiction='MUNICIPAL') ORDER BY CASE jurisdiction WHEN 'MUNICIPAL' THEN 1 WHEN 'STATE' THEN 2 ELSE 3 END,CASE WHEN topics ?| $2::text[] THEN 0 ELSE 1 END,norm_year DESC NULLS LAST,norm_number LIMIT 60",[org,topics]);
 return {topics,items:r.rows};
}
async function territorialContext(org:string,incident:any){
 const result:any={riskAreas:[],warningAssets:[],criticalInfrastructures:[],shelters:[]};
 if(incident.latitude==null||incident.longitude==null)return result;
 const lon=Number(incident.longitude),lat=Number(incident.latitude);
 const [risk,warning,infra,shelters]=await Promise.all([
  db.query("SELECT code,name,risk_level AS \"riskLevel\",hazard_type AS \"hazardType\",status,exposed_people AS \"exposedPeople\",round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS \"distanceMeters\" FROM territorial_risk_areas WHERE organization_id=$1 AND status<>'INACTIVE' AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,5000) ORDER BY \"distanceMeters\" LIMIT 12",[org,lon,lat]),
  db.query("SELECT code,name,asset_type AS \"assetType\",status,battery_percent::float8 AS \"batteryPercent\",round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS \"distanceMeters\" FROM warning_assets WHERE organization_id=$1 AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,8000) ORDER BY \"distanceMeters\" LIMIT 12",[org,lon,lat]),
  db.query("SELECT code,name,category,operational_status AS \"operationalStatus\",criticality,backup_power AS \"backupPower\",autonomy_hours::float8 AS \"autonomyHours\",round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS \"distanceMeters\" FROM critical_infrastructures WHERE organization_id=$1 AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,10000) ORDER BY CASE criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,\"distanceMeters\" LIMIT 15",[org,lon,lat]),
  db.query("SELECT name,status,capacity_people AS \"capacityPeople\",accessible,generator_available AS \"generatorAvailable\",pet_area_available AS \"petAreaAvailable\",round(ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS \"distanceMeters\" FROM shelters WHERE organization_id=$1 AND location IS NOT NULL AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,15000) ORDER BY \"distanceMeters\" LIMIT 12",[org,lon,lat])
 ]);
 result.riskAreas=risk.rows;result.warningAssets=warning.rows;result.criticalInfrastructures=infra.rows;result.shelters=shelters.rows;return result;
}
async function geoPixelContext(org:string,incident:any){
 if(incident.latitude==null||incident.longitude==null)return {features:[]};
 const r=await db.query("SELECT l.code AS \"layerCode\",l.title AS \"layerTitle\",l.category,f.remote_id AS \"remoteId\",round(ST_Distance(f.geometry::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS \"distanceMeters\",f.properties FROM geopixel_features f JOIN geopixel_layers l ON l.id=f.layer_id WHERE f.organization_id=$1 AND f.active=true AND f.geometry IS NOT NULL AND ST_DWithin(f.geometry::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,10000) ORDER BY \"distanceMeters\",l.category LIMIT 30",[org,Number(incident.longitude),Number(incident.latitude)]);
 return {features:r.rows};
}

export async function legalAiRoutes(app:FastifyInstance){
 app.post("/api/v1/ai/contextual-assist",{preHandler:requireAuth},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(request),parsed=contextualAssistInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",message:"Pergunta ou rota inválida."});
  const {route,question}=parsed.data,module=contextualModule(route),permissions=new Set(auth.permissions);
  const can=(...values:string[])=>permissions.has("system.master")||values.some(v=>permissions.has(v));
  const context:Record<string,unknown>={module,route,generatedAt:new Date().toISOString()};
  const tasks:Promise<void>[]=[];
  const addCount=(key:string,sql:string,allowed:boolean)=>{if(!allowed)return;tasks.push(db.query(sql,[org]).then(r=>{context[key]=Number(r.rows[0]?.value??0)}).catch(()=>{}))};
  addCount("ocorrenciasAbertas","SELECT count(*)::int AS value FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE')",can("incidents.read","incidents.manage"));
  addCount("ocorrenciasPrioridadeP1P2","SELECT count(*)::int AS value FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE') AND priority IN ('P1','P2')",can("incidents.read","incidents.manage"));
  addCount("eventosMonitoramentoAbertos","SELECT count(*)::int AS value FROM monitoring_events WHERE organization_id=$1 AND status<>'CLOSED'",can("monitoring.read","monitoring.manage"));
  addCount("familiasAcompanhadas","SELECT count(*)::int AS value FROM assisted_households WHERE organization_id=$1 AND departed_at IS NULL",can("humanitarian.read","humanitarian.manage"));
  addCount("abrigosAbertos","SELECT count(*)::int AS value FROM shelters WHERE organization_id=$1 AND status IN ('OPEN','FULL')",can("humanitarian.read","humanitarian.manage"));
  addCount("voluntariosAtivos","SELECT count(*)::int AS value FROM volunteers WHERE organization_id=$1 AND status='ACTIVE'",can("volunteers.read","volunteers.manage"));
  addCount("documentosEmitidos","SELECT count(*)::int AS value FROM technical_documents WHERE organization_id=$1 AND status='ISSUED'",can("documents.read","documents.manage"));
  addCount("planconAtivos","SELECT count(*)::int AS value FROM contingency_plans WHERE organization_id=$1 AND status='ACTIVE'",can("plancon.manage"));
  await Promise.all(tasks);
  const incidentMatch=route.match(/^\/ocorrencias\/([0-9a-f-]{36})(?:\/|$)/i);
  if(incidentMatch&&can("incidents.read","incidents.manage")&&uuid.safeParse(incidentMatch[1]).success){
   const incident=await loadIncident(org,incidentMatch[1]);if(incident)context.ocorrenciaAtual=incident;
  }
  if(route.startsWith("/administracao")&&can("system.master","admin.features","integrations.manage")){
   const [features,integrations]=await Promise.all([
    db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE enabled=false)::int AS disabled FROM feature_flags WHERE organization_id=$1",[org]),
    db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active FROM integration_endpoints WHERE organization_id=$1",[org])
   ]);
   context.administracao={featureFlags:features.rows[0],integracoes:integrations.rows[0]};
  }
  const result=await generateContextualAnswer({module,route,question,context});
  await db.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,metadata) VALUES($1,'AI_CONTEXTUAL_ASSIST','ai_assist',$2,$3,$4,$5::jsonb)",[auth.userId,route,request.ip,request.headers["user-agent"]??null,JSON.stringify({module,provider:result.provider,model:result.model,result:result.result,promptHash:result.promptHash,outputHash:result.outputHash,latencyMs:result.latencyMs})]).catch(()=>{});
  return {answer:result.draft,provider:result.provider,model:result.model,result:result.result,module};
 });

 app.get("/api/v1/legal/norms",{preHandler:requirePermission("legal.read")},async request=>{
  const o=organizationId(request),q=request.query as {q?:string;topic?:string;jurisdiction?:string;status?:string;limit?:string};
  const params:any[]=[o];let where="(organization_id IS NULL OR organization_id=$1)";
  if(q.jurisdiction){params.push(q.jurisdiction);where+=" AND jurisdiction=$"+params.length}
  if(q.status){params.push(q.status);where+=" AND status=$"+params.length}else where+=" AND status='ACTIVE'";
  if(q.topic){params.push(topic(q.topic));where+=" AND topics ? $"+params.length}
  if(q.q){params.push(q.q.trim());where+=" AND to_tsvector('portuguese',coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(full_text,'')) @@ plainto_tsquery('portuguese',$"+params.length+")"}
  params.push(Math.max(1,Math.min(500,Number(q.limit??200))));
  const sql="SELECT id,jurisdiction,state_code AS \"stateCode\",municipality,norm_type AS \"normType\",norm_number AS \"normNumber\",norm_year AS \"normYear\",title,summary,status,source_url AS \"sourceUrl\",official_source AS \"officialSource\",topics,verified_at AS \"verifiedAt\",verification_notes AS \"verificationNotes\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM legal_norms WHERE "+where+" ORDER BY CASE jurisdiction WHEN 'MUNICIPAL' THEN 1 WHEN 'STATE' THEN 2 ELSE 3 END,norm_year DESC NULLS LAST,norm_number LIMIT $"+params.length;
  const r=await db.query(sql,params);return {items:r.rows};
 });

 app.post("/api/v1/legal/norms",{preHandler:requirePermission("legal.manage")},async(request,reply)=>{
  const a=authFrom(request),o=organizationId(request),p=normInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,sourceHash=v.fullText?sha(v.fullText):null;
  const existing=await db.query("SELECT id FROM legal_norms WHERE COALESCE(organization_id,$1)=$1 AND jurisdiction=$2 AND COALESCE(state_code,'')=$3 AND COALESCE(municipality,'')=$4 AND norm_type=$5 AND norm_number=$6 AND COALESCE(norm_year,0)=COALESCE($7,0) LIMIT 1",[o,v.jurisdiction,v.stateCode,v.municipality,v.normType,v.normNumber,v.normYear??null]);
  if(existing.rows[0]){
   const r=await db.query("UPDATE legal_norms SET title=$3,summary=$4,status=$5,source_url=$6,official_source=$7,topics=$8::jsonb,full_text=CASE WHEN $9<>'' THEN $9 ELSE full_text END,source_hash=COALESCE($10,source_hash),verified_at=now(),verification_notes=$11,updated_at=now() WHERE id=$1 AND (organization_id IS NULL OR organization_id=$2) RETURNING id",[existing.rows[0].id,o,v.title,v.summary||null,v.status,v.sourceUrl,v.officialSource,JSON.stringify(v.topics.map(topic)),v.fullText,sourceHash,v.verificationNotes||null]);return r.rows[0];
  }
  const r=await db.query("INSERT INTO legal_norms(organization_id,jurisdiction,state_code,municipality,norm_type,norm_number,norm_year,title,summary,status,source_url,official_source,topics,full_text,source_hash,verified_at,verification_notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,now(),$16,$17) RETURNING id",[o,v.jurisdiction,v.stateCode||null,v.municipality||null,v.normType,v.normNumber,v.normYear??null,v.title,v.summary||null,v.status,v.sourceUrl,v.officialSource,JSON.stringify(v.topics.map(topic)),v.fullText||null,sourceHash,v.verificationNotes||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/incidents/:id/legal-context",{preHandler:requirePermission("incidents.read")},async(request,reply)=>{
  const o=organizationId(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const incident=await loadIncident(o,id);if(!incident)return reply.code(404).send({error:"NOT_FOUND"});
  const legal=await legalContext(o,incident);
  return {topics:legal.topics,items:legal.items,notice:"Contexto normativo assistivo. Verifique vigência, alterações, regulamentação e aplicabilidade antes da conclusão técnica ou jurídica."};
 });

 app.get("/api/v1/ai/reports",{preHandler:requirePermission("ai.report.generate")},async request=>{
  const o=organizationId(request),r=await db.query("SELECT r.id,r.report_type AS \"reportType\",r.title,r.ai_assisted AS \"aiAssisted\",r.ai_provider AS \"aiProvider\",r.ai_model AS \"aiModel\",r.status,r.created_at AS \"createdAt\",r.reviewed_at AS \"reviewedAt\",r.approved_at AS \"approvedAt\",i.protocol,i.summary,u.display_name AS \"createdByName\",u.matricula AS \"createdByMatricula\" FROM technical_report_drafts r LEFT JOIN incidents i ON i.id=r.incident_id JOIN users u ON u.id=r.created_by WHERE r.organization_id=$1 ORDER BY r.created_at DESC LIMIT 300",[o]);return {items:r.rows};
 });

 app.get("/api/v1/ai/reports/:id",{preHandler:requirePermission("ai.report.generate")},async(request,reply)=>{
  const o=organizationId(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query("SELECT r.id,r.incident_id AS \"incidentId\",r.report_type AS \"reportType\",r.title,r.context_snapshot AS \"contextSnapshot\",r.legal_context AS \"legalContext\",r.draft_text AS \"draftText\",r.ai_assisted AS \"aiAssisted\",r.ai_provider AS \"aiProvider\",r.ai_model AS \"aiModel\",r.status,r.created_at AS \"createdAt\",r.reviewed_at AS \"reviewedAt\",r.approved_at AS \"approvedAt\",i.protocol FROM technical_report_drafts r LEFT JOIN incidents i ON i.id=r.incident_id WHERE r.id=$1 AND r.organization_id=$2",[id,o]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.post("/api/v1/ai/reports/generate",{preHandler:requirePermission("ai.report.generate")},async(request,reply)=>{
  const a=authFrom(request),o=organizationId(request),p=generateInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const incident=await loadIncident(o,p.data.incidentId);if(!incident)return reply.code(404).send({error:"INCIDENT_NOT_FOUND"});
  const [legal,territorial,geopixel]=await Promise.all([legalContext(o,incident),territorialContext(o,incident),geoPixelContext(o,incident)]);
  const title=p.data.title||("Relatório técnico assistido — "+incident.protocol);
  const input={title,reportType:p.data.reportType,incident,territorial,geopixel,legal:legal.items,additionalInstructions:p.data.additionalInstructions};
  const result=await generateTechnicalDraft(input);
  const report=await db.query("INSERT INTO technical_report_drafts(organization_id,incident_id,report_type,title,context_snapshot,legal_context,draft_text,ai_assisted,ai_provider,ai_model,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id,status,created_at AS \"createdAt\"",[o,p.data.incidentId,p.data.reportType,title,JSON.stringify({incident,territorial,geopixel,topics:legal.topics}),JSON.stringify(legal.items),result.draft,result.provider==="OPENAI",result.provider,result.model,a.userId]);
  await db.query("INSERT INTO ai_interactions(organization_id,actor_user_id,report_id,incident_id,purpose,provider,model,prompt_hash,input_snapshot,output_hash,latency_ms,input_tokens,output_tokens,result) VALUES($1,$2,$3,$4,'TECHNICAL_REPORT',$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)",[o,a.userId,report.rows[0].id,p.data.incidentId,result.provider,result.model,result.promptHash,JSON.stringify({reportType:p.data.reportType,legalNormCount:legal.items.length,riskAreaCount:territorial.riskAreas.length,geoPixelFeatureCount:geopixel.features.length}),result.outputHash,result.latencyMs,result.inputTokens,result.outputTokens,result.result]);
  return reply.code(201).send({...report.rows[0],draftText:result.draft,aiProvider:result.provider,aiModel:result.model,result:result.result});
 });

 app.patch("/api/v1/ai/reports/:id/review",{preHandler:requirePermission("ai.report.review")},async(request,reply)=>{
  const a=authFrom(request),o=organizationId(request),{id}=request.params as {id:string},p=reviewInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const before=await db.query("SELECT status,draft_text FROM technical_report_drafts WHERE id=$1 AND organization_id=$2",[id,o]);if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const text=p.data.draftText??before.rows[0].draft_text,status=p.data.status;
  const r=await db.query("UPDATE technical_report_drafts SET status=$3,draft_text=$4,reviewed_by=CASE WHEN $3 IN('IN_REVIEW','APPROVED','REJECTED') THEN $5 ELSE reviewed_by END,reviewed_at=CASE WHEN $3 IN('IN_REVIEW','APPROVED','REJECTED') THEN now() ELSE reviewed_at END,approved_by=CASE WHEN $3='APPROVED' THEN $5 ELSE approved_by END,approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status,draft_text AS \"draftText\",reviewed_at AS \"reviewedAt\",approved_at AS \"approvedAt\"",[id,o,status,text,a.userId]);
  await db.query("UPDATE ai_interactions SET human_decision=$2,human_decision_at=now() WHERE report_id=$1 AND human_decision IS NULL",[id,status==="APPROVED"?(text===before.rows[0].draft_text?"ACCEPTED":"CORRECTED"):"REJECTED"]);
  await db.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata) VALUES($1,'AI_REPORT_REVIEWED','technical_report',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)",[a.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({status:before.rows[0].status,textHash:sha(before.rows[0].draft_text)}),JSON.stringify({status,textHash:sha(text)}),JSON.stringify({reviewNotes:p.data.reviewNotes||null})]);
  return r.rows[0];
 });
}
