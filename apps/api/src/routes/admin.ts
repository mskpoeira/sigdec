import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {authFrom,requireAuth,requirePermission,requireSecurityReady} from "../auth.js";
import {db} from "../db.js";

const FEATURES=[
 ["incidents","Ocorrências"],["dispatch","Despacho"],["field","Operação de campo"],["inspections","Vistorias"],
 ["monitoring","Monitoramento"],["alerts","Alertas"],["humanitarian","Assistência humanitária"],["volunteers","Voluntariado"],
 ["communications","Comunicações"],["documents","Documentos"],["sco","SCO"],["risks","Riscos"],["s2id","S2iD"],
 ["training","Treinamentos"],["recovery","Recuperação"],["library","Biblioteca"],["bi","BI"],
 ["assistive","Inteligência assistiva"],["sidec","Interoperabilidade SIDEC"],["sidec-continuity","Continuidade SIDEC"]
] as const;
const featureCodes=new Set(FEATURES.map(([code])=>code));
const featureSchema=z.object({enabled:z.boolean()});
const integrationSchema=z.object({
 name:z.string().trim().min(3).max(160),
 integrationType:z.enum(["API","WEBHOOK","IMPORT","EXPORT"]),
 endpointUrl:z.string().url().max(2000).optional(),
 active:z.boolean().default(true),
 config:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})
}).superRefine((v,ctx)=>{
 if((v.integrationType==="API"||v.integrationType==="WEBHOOK")&&!v.endpointUrl){
  ctx.addIssue({code:z.ZodIssueCode.custom,path:["endpointUrl"],message:"URL obrigatória para API/webhook."});
 }
 if(v.endpointUrl){
  try{const u=new URL(v.endpointUrl);if(!["https:","http:"].includes(u.protocol))throw new Error();
   if(u.protocol==="http:"&&u.hostname!=="localhost")ctx.addIssue({code:z.ZodIssueCode.custom,path:["endpointUrl"],message:"Integrações remotas devem usar HTTPS."});
  }catch{ctx.addIssue({code:z.ZodIssueCode.custom,path:["endpointUrl"],message:"URL inválida."});}
 }
});
const activeSchema=z.object({active:z.boolean()});

function organizationId(value:string|null){if(!value)throw Object.assign(new Error("Usuário sem organização vinculada."),{statusCode:409});return value}

export async function adminRoutes(app:FastifyInstance){
 app.get("/api/v1/dashboard/summary",{preHandler:requireSecurityReady},async request=>{
  const org=organizationId(authFrom(request).organizationId);
  const result=await db.query(`SELECT
   (SELECT count(*)::int FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE')) AS "activeIncidents",
   (SELECT count(*)::int FROM incidents WHERE organization_id=$1 AND created_at>=now()-interval '24 hours') AS "incidents24h",
   (SELECT count(*)::int FROM assisted_households WHERE organization_id=$1 AND departed_at IS NULL) AS "activeHouseholds",
   (SELECT COALESCE(sum(CASE WHEN m.movement_type IN ('IN','ADJUST_IN') THEN m.quantity ELSE -m.quantity END),0)::float8
      FROM humanitarian_stock_movements m WHERE m.organization_id=$1) AS "stockBalance",
   (SELECT count(*)::int FROM volunteers WHERE organization_id=$1 AND status='ACTIVE') AS "activeVolunteers",
   (SELECT count(*)::int FROM trainings WHERE organization_id=$1 AND starts_at>=now()) AS "upcomingTrainings"`,[org]);
  return result.rows[0];
 });
 app.get("/api/v1/features",{preHandler:requireAuth},async request=>{
  const org=organizationId(authFrom(request).organizationId);
  const stored=await db.query<{code:string;enabled:boolean}>("SELECT code,enabled FROM feature_flags WHERE organization_id=$1",[org]);
  const byCode=new Map(stored.rows.map(x=>[x.code,x.enabled]));
  return {items:FEATURES.map(([code,label])=>({code,label,enabled:byCode.get(code)??true}))};
 });
 app.get("/api/v1/admin/features",{preHandler:requirePermission("admin.features")},async request=>{
  const org=organizationId(authFrom(request).organizationId);
  const stored=await db.query<{code:string;enabled:boolean;updated_at:Date}>(
   "SELECT code,enabled,updated_at FROM feature_flags WHERE organization_id=$1",[org]
  );
  const byCode=new Map(stored.rows.map(x=>[x.code,x]));
  return {items:FEATURES.map(([code,label])=>({code,label,enabled:byCode.get(code)?.enabled??true,updatedAt:byCode.get(code)?.updated_at??null}))};
 });
 app.put("/api/v1/admin/features/:code",{preHandler:requirePermission("admin.features")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{code}=request.params as {code:string};
  if(!featureCodes.has(code as any))return reply.code(404).send({error:"UNKNOWN_FEATURE"});
  const parsed=featureSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const before=await db.query("SELECT enabled FROM feature_flags WHERE organization_id=$1 AND code=$2",[org,code]);
  const result=await db.query(`INSERT INTO feature_flags(organization_id,code,enabled,updated_at)
   VALUES($1,$2,$3,now()) ON CONFLICT(organization_id,code) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()
   RETURNING code,enabled,updated_at AS "updatedAt"`,[org,code,parsed.data.enabled]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
   VALUES($1,'FEATURE_FLAG_CHANGED','feature_flag',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
   auth.userId,code,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]??null),JSON.stringify(result.rows[0])
  ]);
  return result.rows[0];
 });
 app.get("/api/v1/admin/integrations",{preHandler:requirePermission("integrations.manage")},async request=>{
  const org=organizationId(authFrom(request).organizationId);
  const result=await db.query(`SELECT id,name,integration_type AS "integrationType",endpoint_url AS "endpointUrl",active,config,created_at AS "createdAt"
   FROM integration_endpoints WHERE organization_id=$1 ORDER BY name`,[org]);
  return {items:result.rows};
 });
 app.post("/api/v1/admin/integrations",{preHandler:requirePermission("integrations.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),parsed=integrationSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data;
  const result=await db.query(`INSERT INTO integration_endpoints(organization_id,name,integration_type,endpoint_url,active,config)
   VALUES($1,$2,$3,$4,$5,$6::jsonb)
   RETURNING id,name,integration_type AS "integrationType",endpoint_url AS "endpointUrl",active,config,created_at AS "createdAt"`,[
   org,v.name,v.integrationType,v.endpointUrl??null,v.active,JSON.stringify(v.config)
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
   VALUES($1,'INTEGRATION_ENDPOINT_CREATED','integration_endpoint',$2,$3,$4,$5::jsonb)`,[
   auth.userId,result.rows[0].id,request.ip,request.headers["user-agent"]??null,JSON.stringify(result.rows[0])
  ]);
  return reply.code(201).send(result.rows[0]);
 });
 app.patch("/api/v1/admin/integrations/:id/status",{preHandler:requirePermission("integrations.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string},parsed=activeSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const before=await db.query("SELECT id,active FROM integration_endpoints WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const result=await db.query(`UPDATE integration_endpoints SET active=$1 WHERE id=$2 AND organization_id=$3
   RETURNING id,name,integration_type AS "integrationType",endpoint_url AS "endpointUrl",active,config`,[parsed.data.active,id,org]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
   VALUES($1,'INTEGRATION_ENDPOINT_STATUS_CHANGED','integration_endpoint',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
   auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(result.rows[0])
  ]);
  return result.rows[0];
 });
}
