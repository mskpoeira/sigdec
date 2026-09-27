import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";
import {encryptApplicationSecret} from "../lib/app-secrets.js";
import {consultSeiProcess,generateSeiProcess,includeSeiGeneratedDocument,loadSeiConnection,seiHttp,seiOperationsFromWsdl} from "../lib/sei.js";

const uuid=z.string().uuid();
const connectionInput=z.object({
 name:z.string().trim().min(3).max(160),baseUrl:z.string().url().max(3000),wsdlUrl:z.string().url().max(3000),
 systemCode:z.string().trim().min(1).max(120),serviceIdentification:z.string().max(4000).optional().default(""),
 unitId:z.string().trim().min(1).max(80),active:z.boolean().default(true),
 allowedOperations:z.array(z.string().trim().min(1).max(120)).max(100).default([]),
 config:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null(),z.array(z.string())])).default({})
});
const linkInput=z.object({
 connectionId:z.string().uuid(),incidentId:z.string().uuid().optional().or(z.literal("")),
 entityType:z.string().trim().max(80).optional().default(""),entityId:z.string().uuid().optional().or(z.literal("")),
 protocol:z.string().trim().min(3).max(160),processId:z.string().trim().max(120).optional().default(""),
 url:z.string().url().max(3000).optional().or(z.literal("")),processTypeId:z.string().trim().max(120).optional().default(""),processTypeName:z.string().trim().max(300).optional().default("")
});
const generateInput=z.object({
 connectionId:z.string().uuid(),incidentId:z.string().uuid().optional().or(z.literal("")),
 entityType:z.string().trim().max(80).optional().default(""),entityId:z.string().uuid().optional().or(z.literal("")),
 specification:z.string().trim().min(3).max(1000).optional().default(""),processTypeId:z.string().trim().max(120).optional().default(""),
 subjectId:z.string().trim().max(120).optional().default(""),accessLevel:z.string().trim().max(20).optional().default(""),
 legalHypothesisId:z.string().trim().max(120).optional().default("")
});
const includeReportInput=z.object({
 reportId:z.string().uuid(),documentTypeId:z.string().trim().max(120).optional().default(""),
 description:z.string().trim().max(500).optional().default(""),accessLevel:z.string().trim().max(20).optional().default(""),
 legalHypothesisId:z.string().trim().max(120).optional().default("")
});

function org(request:FastifyRequest){const value=authFrom(request).organizationId;if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return value}
function htmlEscape(value:string){return value.replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]??ch))}
function reportHtml(title:string,text:string){return "<h1>"+htmlEscape(title)+"</h1>"+text.split(/\n{2,}/).map(p=>"<p>"+htmlEscape(p).replace(/\n/g,"<br>")+"</p>").join("")}
async function logOperation(input:{organizationId:string;connectionId:string;actorId:string;operation:string;entityType?:string;entityId?:string;requestSummary?:any;responseSummary?:any;success:boolean;error?:string;durationMs:number}){
 await db.query("INSERT INTO sei_operation_logs(organization_id,connection_id,actor_user_id,operation,entity_type,entity_id,request_summary,response_summary,success,error_message,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)",[
  input.organizationId,input.connectionId,input.actorId,input.operation,input.entityType??null,input.entityId??null,
  JSON.stringify(input.requestSummary??{}),JSON.stringify(input.responseSummary??{}),input.success,input.error??null,input.durationMs
 ]);
}

export async function seiRoutes(app:FastifyInstance){
 app.get("/api/v1/sei/connections",{preHandler:requirePermission("sei.read")},async request=>{
  const o=org(request),r=await db.query("SELECT id,name,base_url AS \"baseUrl\",wsdl_url AS \"wsdlUrl\",system_code AS \"systemCode\",(service_key_ciphertext IS NOT NULL) AS \"serviceConfigured\",unit_id AS \"unitId\",active,allowed_operations AS \"allowedOperations\",config,last_test_at AS \"lastTestAt\",last_test_ok AS \"lastTestOk\",last_test_message AS \"lastTestMessage\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM sei_connections WHERE organization_id=$1 ORDER BY name",[o]);return {items:r.rows};
 });

 app.post("/api/v1/sei/connections",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=connectionInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,secret=v.serviceIdentification?encryptApplicationSecret(v.serviceIdentification):null;
  const r=await db.query("INSERT INTO sei_connections(organization_id,name,base_url,wsdl_url,system_code,service_key_ciphertext,unit_id,active,allowed_operations,config,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) RETURNING id,name,active",( [o,v.name,v.baseUrl,v.wsdlUrl,v.systemCode,secret,v.unitId,v.active,JSON.stringify(v.allowedOperations),JSON.stringify(v.config),a.userId] ));
  return reply.code(201).send({...r.rows[0],serviceConfigured:Boolean(secret)});
 });

 app.put("/api/v1/sei/connections/:id",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=connectionInput.safeParse(request.body);if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const v=p.data,secret=v.serviceIdentification?encryptApplicationSecret(v.serviceIdentification):null;
  const r=await db.query("UPDATE sei_connections SET name=$3,base_url=$4,wsdl_url=$5,system_code=$6,service_key_ciphertext=CASE WHEN $7::text IS NULL THEN service_key_ciphertext ELSE $7 END,unit_id=$8,active=$9,allowed_operations=$10::jsonb,config=$11::jsonb,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,name,active,(service_key_ciphertext IS NOT NULL) AS \"serviceConfigured\"",[id,o,v.name,v.baseUrl,v.wsdlUrl,v.systemCode,secret,v.unitId,v.active,JSON.stringify(v.allowedOperations),JSON.stringify(v.config)]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.post("/api/v1/sei/connections/:id/test",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const c=await loadSeiConnection(id,o);if(!c)return reply.code(404).send({error:"NOT_FOUND"});
  const started=Date.now();
  try{
   const r=await seiHttp(c.wsdlUrl,{headers:{accept:"application/xml,text/xml,*/*"},maxBytes:10*1024*1024});
   if(r.status<200||r.status>=400)throw new Error("WSDL SEI respondeu HTTP "+r.status);
   const operations=seiOperationsFromWsdl(r.body),message="WSDL acessível; "+operations.length+" operação(ões) descoberta(s).";
   await db.query("UPDATE sei_connections SET last_test_at=now(),last_test_ok=true,last_test_message=$3,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,message]);
   await logOperation({organizationId:o,connectionId:id,actorId:a.userId,operation:"WSDL_TEST",responseSummary:{status:r.status,operations},success:true,durationMs:Date.now()-started});
   return {ok:true,status:r.status,operations,message};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await db.query("UPDATE sei_connections SET last_test_at=now(),last_test_ok=false,last_test_message=$3,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,message]);
   await logOperation({organizationId:o,connectionId:id,actorId:a.userId,operation:"WSDL_TEST",success:false,error:message,durationMs:Date.now()-started});
   return reply.code(502).send({error:"SEI_TEST_FAILED",message});
  }
 });

 app.get("/api/v1/sei/process-links",{preHandler:requirePermission("sei.read")},async request=>{
  const o=org(request),q=request.query as {incidentId?:string};
  const params:any[]=[o];let where="p.organization_id=$1";if(q.incidentId&&uuid.safeParse(q.incidentId).success){params.push(q.incidentId);where+=" AND p.incident_id=$2"}
  const r=await db.query("SELECT p.id,p.connection_id AS \"connectionId\",c.name AS \"connectionName\",p.incident_id AS \"incidentId\",i.protocol AS \"incidentProtocol\",p.entity_type AS \"entityType\",p.entity_id AS \"entityId\",p.sei_process_id AS \"seiProcessId\",p.sei_protocol AS \"seiProtocol\",p.sei_url AS \"seiUrl\",p.process_type_id AS \"processTypeId\",p.process_type_name AS \"processTypeName\",p.status,p.metadata,p.last_synced_at AS \"lastSyncedAt\",p.created_at AS \"createdAt\" FROM sei_process_links p JOIN sei_connections c ON c.id=p.connection_id LEFT JOIN incidents i ON i.id=p.incident_id WHERE "+where+" ORDER BY p.created_at DESC",params);return {items:r.rows};
 });

 app.post("/api/v1/sei/process-links",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=linkInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,connection=await db.query("SELECT 1 FROM sei_connections WHERE id=$1 AND organization_id=$2",[v.connectionId,o]);if(!connection.rows[0])return reply.code(400).send({error:"INVALID_CONNECTION"});
  const r=await db.query("INSERT INTO sei_process_links(organization_id,connection_id,incident_id,entity_type,entity_id,sei_process_id,sei_protocol,sei_url,process_type_id,process_type_name,status,last_synced_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'LINKED',now(),$11) ON CONFLICT(connection_id,sei_protocol) DO UPDATE SET incident_id=COALESCE(EXCLUDED.incident_id,sei_process_links.incident_id),entity_type=COALESCE(EXCLUDED.entity_type,sei_process_links.entity_type),entity_id=COALESCE(EXCLUDED.entity_id,sei_process_links.entity_id),sei_process_id=COALESCE(EXCLUDED.sei_process_id,sei_process_links.sei_process_id),sei_url=COALESCE(EXCLUDED.sei_url,sei_process_links.sei_url),updated_at=now() RETURNING id,sei_protocol AS \"seiProtocol\"",[o,v.connectionId,v.incidentId||null,v.entityType||null,v.entityId||null,v.processId||null,v.protocol,v.url||null,v.processTypeId||null,v.processTypeName||null,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.post("/api/v1/sei/processes/generate",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=generateInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,c=await loadSeiConnection(v.connectionId,o);if(!c)return reply.code(404).send({error:"CONNECTION_NOT_FOUND"});
  const processTypeId=v.processTypeId||String(c.config?.processTypeId??"");if(!processTypeId)return reply.code(409).send({error:"PROCESS_TYPE_REQUIRED",message:"Configure o tipo de processo SEI ou informe processTypeId."});
  let incident:any=null;if(v.incidentId)incident=(await db.query("SELECT protocol,summary FROM incidents WHERE id=$1 AND organization_id=$2",[v.incidentId,o])).rows[0];
  const specification=v.specification||((incident?.protocol?incident.protocol+" · ":"")+(incident?.summary??"Processo SIGDEC"));
  const started=Date.now();
  try{
   const generated=await generateSeiProcess(c,{processTypeId,specification,subjectId:v.subjectId||String(c.config?.subjectId??"")||undefined,accessLevel:v.accessLevel||String(c.config?.accessLevel??"")||undefined,legalHypothesisId:v.legalHypothesisId||String(c.config?.legalHypothesisId??"")||undefined,units:Array.isArray(c.config?.destinationUnits)?c.config.destinationUnits:[]});
   if(!generated.protocol)throw new Error("SEI não retornou o número formatado do processo.");
   const link=await db.query("INSERT INTO sei_process_links(organization_id,connection_id,incident_id,entity_type,entity_id,sei_process_id,sei_protocol,sei_url,process_type_id,status,metadata,last_synced_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'LINKED',$10::jsonb,now(),$11) RETURNING id,sei_protocol AS \"seiProtocol\",sei_url AS \"seiUrl\"",[o,c.id,v.incidentId||null,v.entityType||null,v.entityId||null,generated.id,generated.protocol,generated.link,processTypeId,JSON.stringify({specification}),a.userId]);
   await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"gerarProcedimento",entityType:v.entityType||"incident",entityId:v.entityId||v.incidentId||undefined,requestSummary:{processTypeId,specification},responseSummary:{id:generated.id,protocol:generated.protocol,link:generated.link},success:true,durationMs:Date.now()-started});
   return reply.code(201).send(link.rows[0]);
  }catch(error:any){
   const message=error instanceof Error?error.message:String(error);await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"gerarProcedimento",entityType:v.entityType||"incident",entityId:v.entityId||v.incidentId||undefined,requestSummary:{processTypeId,specification},success:false,error:message,durationMs:Date.now()-started});return reply.code(error?.statusCode??502).send({error:"SEI_GENERATE_FAILED",message});
  }
 });

 app.post("/api/v1/sei/process-links/:id/consult",{preHandler:requirePermission("sei.read")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const link=await db.query("SELECT id,connection_id AS \"connectionId\",sei_protocol AS \"seiProtocol\" FROM sei_process_links WHERE id=$1 AND organization_id=$2",[id,o]);const item=link.rows[0];if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  const c=await loadSeiConnection(item.connectionId,o);if(!c)return reply.code(404).send({error:"CONNECTION_NOT_FOUND"});const started=Date.now();
  try{
   const result=await consultSeiProcess(c,item.seiProtocol);
   await db.query("UPDATE sei_process_links SET sei_process_id=COALESCE($3,sei_process_id),sei_url=COALESCE($4,sei_url),last_synced_at=now(),metadata=metadata||$5::jsonb,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,result.id,result.link,JSON.stringify({lastConsultedAt:new Date().toISOString()})]);
   await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"consultarProcedimento",entityType:"sei_process_link",entityId:id,responseSummary:{id:result.id,protocol:result.protocol,link:result.link},success:true,durationMs:Date.now()-started});
   return {ok:true,id:result.id,protocol:result.protocol,link:result.link};
  }catch(error:any){const message=error instanceof Error?error.message:String(error);await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"consultarProcedimento",entityType:"sei_process_link",entityId:id,success:false,error:message,durationMs:Date.now()-started});return reply.code(error?.statusCode??502).send({error:"SEI_CONSULT_FAILED",message})}
 });

 app.post("/api/v1/sei/process-links/:id/include-report",{preHandler:requirePermission("sei.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=includeReportInput.safeParse(request.body);if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const link=await db.query("SELECT id,connection_id AS \"connectionId\",sei_protocol AS \"seiProtocol\" FROM sei_process_links WHERE id=$1 AND organization_id=$2",[id,o]);const item=link.rows[0];if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  const report=await db.query("SELECT id,title,draft_text AS \"draftText\",status FROM technical_report_drafts WHERE id=$1 AND organization_id=$2",[p.data.reportId,o]);const rep=report.rows[0];if(!rep)return reply.code(404).send({error:"REPORT_NOT_FOUND"});
  if(rep.status!=="APPROVED")return reply.code(409).send({error:"REPORT_NOT_APPROVED",message:"Somente relatório revisado e aprovado por responsável humano pode ser enviado ao SEI."});
  const c=await loadSeiConnection(item.connectionId,o);if(!c)return reply.code(404).send({error:"CONNECTION_NOT_FOUND"});
  const documentTypeId=p.data.documentTypeId||String(c.config?.documentTypeId??"");if(!documentTypeId)return reply.code(409).send({error:"DOCUMENT_TYPE_REQUIRED"});
  const started=Date.now();
  try{
   const included=await includeSeiGeneratedDocument(c,{protocol:item.seiProtocol,documentTypeId,description:p.data.description||rep.title,content:reportHtml(rep.title,rep.draftText),accessLevel:p.data.accessLevel||String(c.config?.accessLevel??"")||undefined,legalHypothesisId:p.data.legalHypothesisId||String(c.config?.legalHypothesisId??"")||undefined});
   const document=await db.query("INSERT INTO sei_document_links(organization_id,process_link_id,report_id,sei_document_id,sei_document_protocol,sei_url,document_type_id,document_type_name,content_hash,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id,sei_document_protocol AS \"seiDocumentProtocol\",sei_url AS \"seiUrl\"",[o,id,rep.id,included.id,included.protocol,included.link,documentTypeId,p.data.description||rep.title,null,JSON.stringify({source:"technical_report",approved:true}),a.userId]);
   await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"incluirDocumento",entityType:"technical_report",entityId:rep.id,requestSummary:{process:item.seiProtocol,documentTypeId},responseSummary:{id:included.id,protocol:included.protocol,link:included.link},success:true,durationMs:Date.now()-started});
   return reply.code(201).send(document.rows[0]);
  }catch(error:any){const message=error instanceof Error?error.message:String(error);await logOperation({organizationId:o,connectionId:c.id,actorId:a.userId,operation:"incluirDocumento",entityType:"technical_report",entityId:rep.id,requestSummary:{process:item.seiProtocol,documentTypeId},success:false,error:message,durationMs:Date.now()-started});return reply.code(error?.statusCode??502).send({error:"SEI_DOCUMENT_FAILED",message})}
 });

 app.get("/api/v1/sei/operation-logs",{preHandler:requirePermission("sei.read")},async request=>{
  const o=org(request),r=await db.query("SELECT l.id,c.name AS \"connectionName\",l.operation,l.entity_type AS \"entityType\",l.entity_id AS \"entityId\",l.success,l.error_message AS \"errorMessage\",l.duration_ms AS \"durationMs\",l.created_at AS \"createdAt\",u.display_name AS \"actorName\",u.matricula AS \"actorMatricula\" FROM sei_operation_logs l JOIN sei_connections c ON c.id=l.connection_id JOIN users u ON u.id=l.actor_user_id WHERE l.organization_id=$1 ORDER BY l.created_at DESC LIMIT 200",[o]);return {items:r.rows};
 });
}
