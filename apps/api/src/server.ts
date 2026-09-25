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
app.addHook("onResponse",async(request,reply)=>{
 const method=request.method.toUpperCase();
 if(!["POST","PUT","PATCH","DELETE"].includes(method)||reply.statusCode>=400)return;
 const auth=(request as typeof request & {auth?:{userId:string}}).auth;
 if(!auth?.userId)return;
 const routePath=request.routeOptions?.url??request.url.split("?")[0]??request.url;
 try{
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,metadata)
   VALUES($1,$2,'request_mutation',$3,$4,$5,$6::jsonb)`,[
    auth.userId,`REQUEST_${method}`,routePath,request.ip,request.headers["user-agent"]??null,
    JSON.stringify({method,path:routePath,statusCode:reply.statusCode})
  ]);
 }catch(error){
  request.log.error({err:error,method,path:routePath},"Falha ao registrar auditoria universal da atividade.");
 }
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
await app.register(authRoutes);await app.register(incidentRoutes);await app.register(responseRoutes);await app.register(fieldRoutes);await app.register(commandRoutes);await app.register(planningRoutes);await app.register(documentRoutes);await app.register(adminRoutes);await app.register(adminUserRoutes);await app.register(adminDataRoutes);await app.register(sidecRoutes);await app.register(continuityRoutes);
app.get("/api/v1",async()=>({name:"SIGDEC API",version:"v1",release,modules:["auth","ocorrencias","despacho","campo","riscos","monitoramento","alertas","vistorias","documentos","desastres","sco","assistencia-humanitaria","voluntariado","logistica","comunicacoes","s2id","treinamentos","recuperacao","biblioteca","bi","administracao","integracoes","sidec-interoperabilidade","sidec-continuidade","inteligencia-assistiva","auditoria"]}));
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
