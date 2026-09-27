import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";
import {institutionalMailStatus,listInstitutionalInbox,sendInstitutionalMail,verifyInstitutionalSmtp} from "../lib/institutional-mail.js";

const sendSchema=z.object({
 to:z.array(z.string().trim().email().max(254)).min(1).max(50),
 cc:z.array(z.string().trim().email().max(254)).max(50).optional().default([]),
 subject:z.string().trim().min(1).max(500),
 text:z.string().min(1).max(200000),
 replyTo:z.string().trim().email().max(254).optional()
});
function org(auth:{organizationId:string|null}){if(!auth.organizationId)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return auth.organizationId}

export async function institutionalMailRoutes(app:FastifyInstance){
 app.get("/api/v1/institutional-mail/status",{preHandler:requirePermission("communications.read")},async()=>institutionalMailStatus());

 app.get("/api/v1/institutional-mail/inbox",{preHandler:requirePermission("communications.read")},async(request,reply)=>{
  const q=request.query as {limit?:string};
  try{
   const items=await listInstitutionalInbox(Number(q.limit??25));
   return {items,readOnly:true,status:institutionalMailStatus()};
  }catch(error){
   request.log.warn({err:error},"Falha ao consultar caixa IMAP institucional.");
   return reply.code(503).send({error:"INSTITUTIONAL_MAIL_UNAVAILABLE",message:error instanceof Error?error.message:"E-mail institucional indisponível."});
  }
 });

 app.post("/api/v1/institutional-mail/send",{preHandler:requirePermission("communications.manage")},async(request,reply)=>{
  const auth=authFrom(request),organizationId=org(auth),parsed=sendSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  try{
   const result=await sendInstitutionalMail(parsed.data);
   await db.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,metadata) VALUES($1,'INSTITUTIONAL_MAIL_SENT','institutional_mail',$2,$3,$4,$5::jsonb)",[
    auth.userId,result.messageId??"smtp-message",request.ip,request.headers["user-agent"]??null,
    JSON.stringify({organizationId,toCount:parsed.data.to.length,ccCount:parsed.data.cc.length,subjectLength:parsed.data.subject.length,acceptedCount:result.accepted.length,rejectedCount:result.rejected.length})
   ]);
   return {ok:true,...result};
  }catch(error){
   request.log.warn({err:error},"Falha ao enviar e-mail institucional.");
   return reply.code(502).send({error:"INSTITUTIONAL_MAIL_SEND_FAILED",message:error instanceof Error?error.message:"Falha ao enviar e-mail."});
  }
 });

 app.post("/api/v1/institutional-mail/test",{preHandler:requirePermission("integrations.manage")},async(request,reply)=>{
  try{
   await verifyInstitutionalSmtp();
   const inbox=await listInstitutionalInbox(1);
   return {ok:true,smtp:true,imap:true,inboxReachable:true,sampleCount:inbox.length};
  }catch(error){
   return reply.code(502).send({ok:false,error:"INSTITUTIONAL_MAIL_TEST_FAILED",message:error instanceof Error?error.message:"Falha no teste do e-mail institucional."});
  }
 });
}
