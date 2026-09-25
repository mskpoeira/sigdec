import {createHmac,randomBytes} from "node:crypto";
import {lookup} from "node:dns/promises";
import {db} from "../db.js";
import {decryptApplicationSecret,encryptApplicationSecret} from "./app-secrets.js";

function privateIpv4(address:string){
 const p=address.split(".").map(Number);
 if(p.length!==4||p.some(x=>!Number.isInteger(x)))return false;
 return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===192&&p[1]===168)||(p[0]===172&&p[1]>=16&&p[1]<=31);
}
function privateIpv6(address:string){
 const a=address.toLowerCase();
 return a==="::1"||a.startsWith("fc")||a.startsWith("fd")||a.startsWith("fe8")||a.startsWith("fe9")||a.startsWith("fea")||a.startsWith("feb");
}

export async function assertSafeWebhookUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=="https:"&&!(process.env.NODE_ENV!=="production"&&url.protocol==="http:"&&["localhost","127.0.0.1","::1"].includes(url.hostname))){
  throw new Error("Webhook remoto deve usar HTTPS.");
 }
 if(["localhost","0.0.0.0","127.0.0.1","::1"].includes(url.hostname)&&process.env.NODE_ENV==="production")throw new Error("Destino local não permitido.");
 const addresses=await lookup(url.hostname,{all:true,verbatim:true});
 if(process.env.NODE_ENV==="production"&&addresses.some(x=>x.family===4?privateIpv4(x.address):privateIpv6(x.address))){
  throw new Error("Webhook não pode apontar para rede privada/local.");
 }
 return url;
}

export function newWebhookSecret(){return randomBytes(32).toString("base64url");}
export function encryptWebhookSecret(secret:string){return encryptApplicationSecret(secret);}

async function enqueueWebhookEvents(){
 await db.query(`INSERT INTO webhook_deliveries(endpoint_id,audit_log_id,event_action,payload)
  SELECT e.id,a.id,a.action,
   jsonb_build_object(
    'eventId',a.id,'occurredAt',a.occurred_at,'action',a.action,'entityType',a.entity_type,'entityId',a.entity_id,
    'data',CASE WHEN COALESCE((e.config->>'includeData')::boolean,false)
      THEN jsonb_build_object('before',a.before_data,'after',a.after_data,'metadata',a.metadata)
      ELSE jsonb_build_object('metadata',a.metadata) END
   )
  FROM integration_endpoints e
  JOIN audit_logs a ON true
  LEFT JOIN users u ON u.id=a.actor_user_id
  WHERE e.integration_type='WEBHOOK' AND e.active=true AND e.webhook_secret_ciphertext IS NOT NULL
    AND u.organization_id=e.organization_id
    AND a.action NOT LIKE 'auth.login_failed'
    AND (COALESCE(e.config->>'eventPrefix','')='' OR a.action LIKE (e.config->>'eventPrefix')||'%')
    AND NOT EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.endpoint_id=e.id AND d.audit_log_id=a.id)
  ORDER BY a.id
  LIMIT 500
  ON CONFLICT(endpoint_id,audit_log_id) DO NOTHING`);
}

export async function deliverWebhookById(id:string){
 const result=await db.query(`SELECT d.id,d.endpoint_id AS "endpointId",d.event_action AS "eventAction",d.payload,d.attempts,
   e.endpoint_url AS "endpointUrl",e.webhook_secret_ciphertext AS "secretCiphertext"
  FROM webhook_deliveries d
  JOIN integration_endpoints e ON e.id=d.endpoint_id
  WHERE d.id=$1 AND d.status='PENDING' AND e.active=true AND e.integration_type='WEBHOOK'`,[id]);
 const item=result.rows[0] as any;
 if(!item)return {processed:false};
 try{
  await assertSafeWebhookUrl(String(item.endpointUrl));
  const body=JSON.stringify(item.payload);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac("sha256",decryptApplicationSecret(String(item.secretCiphertext))).update(timestamp+"."+body).digest("hex");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  let response:Response;
  try{
   response=await fetch(String(item.endpointUrl),{
    method:"POST",headers:{
     "content-type":"application/json","user-agent":"SIGDEC-Webhook/1.41",
     "x-sigdec-event":String(item.eventAction),"x-sigdec-delivery":String(item.id),
     "x-sigdec-timestamp":timestamp,"x-sigdec-signature":"sha256="+signature
    },body,signal:controller.signal,redirect:"error"
   });
  }finally{clearTimeout(timer)}
  const excerpt=(await response.text().catch(()=>"")).slice(0,1000);
  if(!response.ok)throw Object.assign(new Error(`HTTP ${response.status}`),{status:response.status,excerpt});
  await db.query(`UPDATE webhook_deliveries SET status='SUCCEEDED',attempts=attempts+1,last_attempt_at=now(),
    delivered_at=now(),response_status=$2,response_excerpt=$3,last_error=NULL WHERE id=$1`,[id,response.status,excerpt]);
  await db.query("UPDATE integration_endpoints SET last_delivery_at=now(),delivery_failure_count=0 WHERE id=$1",[item.endpointId]);
  return {processed:true,success:true,status:response.status};
 }catch(error:any){
  const attempts=Number(item.attempts??0)+1;
  const terminal=attempts>=10;
  const delaySeconds=Math.min(3600,15*Math.pow(2,Math.max(0,attempts-1)));
  await db.query(`UPDATE webhook_deliveries SET status=$2,attempts=$3,last_attempt_at=now(),
    next_attempt_at=now()+($4::text||' seconds')::interval,response_status=$5,response_excerpt=$6,last_error=$7
    WHERE id=$1`,[
    id,terminal?"FAILED":"PENDING",attempts,delaySeconds,error?.status??null,error?.excerpt??null,
    error instanceof Error?error.message:String(error)
   ]);
  await db.query("UPDATE integration_endpoints SET delivery_failure_count=delivery_failure_count+1 WHERE id=$1",[item.endpointId]);
  return {processed:true,success:false,terminal,error:error instanceof Error?error.message:String(error)};
 }
}

export async function dispatchWebhooks(){
 await enqueueWebhookEvents();
 const due=await db.query<{id:string}>(`SELECT id FROM webhook_deliveries
  WHERE status='PENDING' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20`);
 let success=0,failed=0;
 for(const row of due.rows){
  const r=await deliverWebhookById(row.id);
  if((r as any).success)success++;else failed++;
 }
 return {queued:due.rowCount??0,success,failed};
}

export async function queueWebhookTest(endpointId:string,actorUserId:string){
 const endpoint=await db.query(`SELECT id,organization_id AS "organizationId",name,endpoint_url AS "endpointUrl",
   webhook_secret_ciphertext AS "secretCiphertext",active,integration_type AS "integrationType"
  FROM integration_endpoints WHERE id=$1`,[endpointId]);
 const item=endpoint.rows[0] as any;
 if(!item||item.integrationType!=="WEBHOOK"||!item.active)throw Object.assign(new Error("Webhook ativo não encontrado."),{statusCode:404});
 if(!item.secretCiphertext)throw Object.assign(new Error("Configure/rotacione o segredo do webhook antes do teste."),{statusCode:409});
 const inserted=await db.query<{id:string}>(`INSERT INTO webhook_deliveries(endpoint_id,audit_log_id,event_action,payload)
  VALUES($1,NULL,'webhook.test',$2::jsonb) RETURNING id`,[
  endpointId,JSON.stringify({eventId:null,occurredAt:new Date().toISOString(),action:"webhook.test",entityType:"integration_endpoint",entityId:endpointId,data:{actorUserId}})
 ]);
 return deliverWebhookById(String(inserted.rows[0].id));
}
