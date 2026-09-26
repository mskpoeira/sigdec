import "dotenv/config";
import apiPackage from "../package.json" with { type: "json" };
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {db} from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { incidentRoutes } from "./routes/incidents.js";
import { responseRoutes } from "./routes/response.js";
import { fieldRoutes } from "./routes/field.js";
import { commandRoutes } from "./routes/command.js";
import { planningRoutes } from "./routes/planning.js";
import { contingencyRoutes } from "./routes/contingency.js";
import { resilienceRoutes } from "./routes/resilience.js";
import { documentRoutes } from "./routes/documents.js";
import { adminRoutes } from "./routes/admin.js";
import {adminUserRoutes} from "./routes/admin-users.js";
import {adminDataRoutes} from "./routes/admin-data.js";
import { dispatchWebhooks } from "./lib/webhooks.js";
import { evaluateSidecArchiveVerifications, evaluateSidecDeadlineAlerts, evaluateSidecResilience, sidecRoutes } from "./routes/sidec.js";
import { continuityRoutes, evaluateContinuityActionAlerts, evaluateContinuityChangeReportArchives, evaluateContinuityChangeReportResilience } from "./routes/continuity.js";
const app=Fastify({logger:true,trustProxy:true});
const release=apiPackage.version;
await app.register(helmet);await app.register(cookie);await app.register(rateLimit,{global:false});
await app.register(cors,{origin:process.env.SIGDEC_PUBLIC_URL??"http://localhost:3000",credentials:true});
app.addHook("onSend",async(request,reply,payload)=>{
 const method=request.method.toUpperCase();
 if(!["POST","PUT","PATCH","DELETE"].includes(method)||reply.statusCode>=400)return payload;
 const auth=(request as typeof request & {auth?:{userId:string}}).auth;
 if(!auth?.userId)return payload;
 const requestPath=request.url.split("?")[0]??request.url;
 const routePath=request.routeOptions?.url??requestPath;
 let responseEntityId:string|null=null;
 if(typeof payload==="string"&&payload.length<200000){
  try{
   const parsed=JSON.parse(payload) as Record<string,unknown>;
   const candidate=parsed.id??(parsed.document as Record<string,unknown>|undefined)?.id??(parsed.item as Record<string,unknown>|undefined)?.id;
   if(typeof candidate==="string"||typeof candidate==="number")responseEntityId=String(candidate);
  }catch{}
 }
 try{
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,metadata)
   VALUES($1,$2,'request_mutation',$3,$4,$5,$6::jsonb)`,[
    auth.userId,`REQUEST_${method}`,responseEntityId??requestPath,request.ip,request.headers["user-agent"]??null,
    JSON.stringify({method,path:routePath,requestPath,statusCode:reply.statusCode,responseEntityId})
  ]);
 }catch(error){
  request.log.error({err:error,method,path:routePath},"Falha ao registrar auditoria universal da atividade.");
 }
 return payload;
});
app.get("/health",async()=>({status:"ok",service:"sigdec-api",version:release,timestamp:new Date().toISOString()}));
app.get("/api/v1/ready",async(_request,reply)=>{
 try{
  await db.query("SELECT 1");
  return {status:"ready",service:"sigdec-api",version:release};
 }catch(error){
  app.log.error({err:error},"Banco indisponível no readiness check.");
  return reply.code(503).send({status:"unavailable",service:"sigdec-api",version:release});
 }
});
await app.register(authRoutes);await app.register(incidentRoutes);await app.register(responseRoutes);await app.register(fieldRoutes);await app.register(commandRoutes);await app.register(planningRoutes);await app.register(contingencyRoutes);await app.register(resilienceRoutes);await app.register(documentRoutes);await app.register(adminRoutes);await app.register(adminUserRoutes);await app.register(adminDataRoutes);await app.register(sidecRoutes);await app.register(continuityRoutes);
app.get("/api/v1",async()=>({
 name:"SIGDEC API",product:"SIGDEC — Sistema Integrado de Gestão de Defesa Civil",version:"v1",release,
 modules:["auth","ocorrencias-monitoramento","assistencia-humanitaria","planejamento-contingencia","operacoes-sco","resiliencia","documentos","administracao","integracoes","auditoria","sidec-interoperabilidade","continuidade"]
}));
app.get("/api/v1/capabilities",async()=>({
 product:"SIGDEC — Sistema Integrado de Gestão de Defesa Civil",release,format:"application/json",
 architecture:{apiFirst:true,postgis:true,appendOnlyAudit:true,ed25519Integrity:true,offlineField:true,multiModule:true},
 modules:[
  {code:"incidents",label:"Ocorrências e Monitoramento",pages:["/ocorrencias","/campo","/monitoramento","/vistorias"]},
  {code:"humanitarian",label:"Assistência Humanitária",pages:["/assistencia"]},
  {code:"planning",label:"Planejamento e Contingência",pages:["/planejamento","/planejamento/operacao"]},
  {code:"operations",label:"Operações / SCO",pages:["/gestao","/sco","/comunicacoes"]},
  {code:"resilience",label:"Resiliência",pages:["/resiliencia","/apoios","/capacitacao","/ajuda-mutua","/operacoes-sazonais","/simulados","/voluntarios"]},
  {code:"documents",label:"Documentos e Continuidade",pages:["/documentos","/continuidade","/verificar-integridade"]},
  {code:"administration",label:"Administração",pages:["/administracao","/administracao/usuarios","/administracao/cadastros","/administracao/auditoria","/administracao/saude","/administracao/apresentacao"]}
 ],
 interoperability:["SIDEC","S2ID","webhooks","JSON","CSV","PDF","KML"],
 generatedAt:new Date().toISOString()
}));
await app.listen({port:Number(process.env.PORT??4000),host:process.env.HOST??"0.0.0.0"});
const sidecDeadlineMinutes=Math.max(5,Math.min(1440,Number(process.env.SIDEC_DEADLINE_EVALUATION_MINUTES??60)));
const evaluateDeadlines=()=>evaluateSidecDeadlineAlerts().catch(error=>app.log.error({err:error},"Falha ao avaliar SLAs SIDEC."));
void evaluateDeadlines();
const sidecDeadlineTimer=setInterval(evaluateDeadlines,sidecDeadlineMinutes*60*1000);
sidecDeadlineTimer.unref();
const sidecArchiveVerificationMinutes=Math.max(60,Math.min(10080,Number(process.env.SIDEC_WORM_VERIFICATION_MINUTES??1440)));
const evaluateArchives=()=>Promise.all([
 evaluateSidecArchiveVerifications(),
 evaluateContinuityChangeReportArchives()
]).catch(error=>app.log.error({err:error},"Falha ao verificar arquivos WORM SIDEC."));
void evaluateArchives();
const sidecArchiveTimer=setInterval(evaluateArchives,sidecArchiveVerificationMinutes*60*1000);
sidecArchiveTimer.unref();

const sidecResilienceMinutes=Math.max(5,Math.min(1440,Number(process.env.SIDEC_RESILIENCE_EVALUATION_MINUTES??15)));
const evaluateResilience=()=>Promise.all([evaluateSidecResilience(),evaluateContinuityChangeReportResilience()]).catch(error=>app.log.error({err:error},"Falha ao avaliar resiliência WORM SIDEC."));
void evaluateResilience();
const sidecResilienceTimer=setInterval(evaluateResilience,sidecResilienceMinutes*60*1000);
sidecResilienceTimer.unref();

const continuityActionAlertMinutes=Math.max(5,Math.min(1440,Number(process.env.SIDEC_CONTINUITY_ACTION_ALERT_MINUTES??60)));
const evaluateContinuityActions=()=>evaluateContinuityActionAlerts().catch(error=>app.log.error({err:error},"Falha ao avaliar ações corretivas de continuidade SIDEC."));
void evaluateContinuityActions();
const continuityActionAlertTimer=setInterval(evaluateContinuityActions,continuityActionAlertMinutes*60*1000);
continuityActionAlertTimer.unref();

const webhookDispatchSeconds=Math.max(10,Math.min(300,Number(process.env.WEBHOOK_DISPATCH_SECONDS??30)));
const evaluateWebhooks=()=>dispatchWebhooks().catch(error=>app.log.error({err:error},"Falha ao processar webhooks SIGDEC."));
void evaluateWebhooks();
const webhookDispatchTimer=setInterval(evaluateWebhooks,webhookDispatchSeconds*1000);
webhookDispatchTimer.unref();
