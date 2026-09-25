import {createHmac,randomBytes} from "node:crypto";
import {lookup} from "node:dns/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {isIP} from "node:net";
import {db} from "../db.js";
import {decryptApplicationSecret,encryptApplicationSecret} from "./app-secrets.js";

export function publicWebhookAddress(address:string){
 const family=isIP(address);
 if(family===4){
  const [a=0,b=0,c=0]=address.split(".").map(Number);
  return !(
   a===0||a===10||a===127||a>=224||
   (a===100&&b>=64&&b<=127)||
   (a===169&&b===254)||(a===172&&b>=16&&b<=31)||
   (a===192&&(b===0&&c===0||b===0&&c===2||b===88&&c===99||b===168))||
   (a===198&&(b===18||b===19||b===51&&c===100))||
   (a===203&&b===0&&c===113)
  );
 }
 // Only IPv6 global unicast is routable to webhook destinations. This also
 // excludes IPv4-mapped IPv6, unique-local, link-local and documentation ranges.
 if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&
  !/^2001:(?:0:|db8:)/i.test(address)&&!/^2002:/i.test(address);
 return false;
}

async function resolveWebhookDestination(value:string){
 const url=new URL(value);
 if(url.username||url.password)throw new Error("Credenciais na URL do webhook não são permitidas.");
 const localDev=process.env.NODE_ENV!=="production"&&url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname);
 if(url.protocol!=="https:"&&!localDev)throw new Error("Webhook remoto deve usar HTTPS.");
 const hostname=url.hostname.replace(/^\[|\]$/g,"");
 const addresses=await lookup(hostname,{all:true,verbatim:true});
 if(!addresses.length||process.env.NODE_ENV==="production"&&addresses.some(x=>!publicWebhookAddress(x.address))){
  throw new Error("Webhook não pode apontar para rede privada/local.");
 }
 return {url,address:addresses[0]!.address,family:addresses[0]!.family};
}

export async function assertSafeWebhookUrl(value:string){
 return (await resolveWebhookDestination(value)).url;
}

async function postWebhook(value:string,body:string,headers:Record<string,string>){
 const {url,address,family}=await resolveWebhookDestination(value);
 return new Promise<{status:number,excerpt:string}>((resolve,reject)=>{
  const request=(url.protocol==="https:"?httpsRequest:httpRequest)(url,{
   method:"POST",headers:{...headers,"content-length":String(Buffer.byteLength(body))},
   // Pin the validated address for the actual connection: a second DNS lookup
   // here would permit DNS rebinding between validation and delivery.
   lookup:(_hostname,_options,callback)=>callback(null,address,family),
   signal:AbortSignal.timeout(10000)
  },response=>{
   let excerpt="";
   response.on("data",(chunk:Buffer)=>{if(excerpt.length<1000)excerpt+=chunk.toString("utf8").slice(0,1000-excerpt.length)});
   response.on("end",()=>resolve({status:response.statusCode??0,excerpt}));
   response.on("error",reject);
  });
  request.on("error",reject);
  request.end(body);
 });
}

export function newWebhookSecret(){return randomBytes(32).toString("base64url");}
export function encryptWebhookSecret(secret:string){return encryptApplicationSecret(secret);}

async function enqueueWebhookEvents(){
 await db.query(`INSERT INTO webhook_deliveries(endpoint_id,audit_log_id,event_action,payload)
  SELECT e.id,a.id,a.action,
   jsonb_build_object(
    'eventId',a.id,'occurredAt',a.occurred_at,'action',a.action,'entityType',a.entity_type,'entityId',a.entity_id,
    'data',CASE WHEN CASE WHEN e.config->>'includeData'='true' THEN true ELSE false END
      THEN jsonb_build_object('before',a.before_data,'after',a.after_data,'metadata',a.metadata)
      ELSE jsonb_build_object('metadata',a.metadata) END
   )
  FROM integration_endpoints e
  JOIN audit_logs a ON true
  LEFT JOIN users u ON u.id=a.actor_user_id
  WHERE e.integration_type='WEBHOOK' AND e.active=true AND e.webhook_secret_ciphertext IS NOT NULL
    AND u.organization_id=e.organization_id
    AND a.occurred_at>=COALESCE(e.webhook_active_from,e.created_at)
    AND a.action NOT LIKE 'auth.login_failed'
    AND (COALESCE(e.config->>'eventPrefix','')='' OR a.action LIKE (e.config->>'eventPrefix')||'%')
    AND NOT EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.endpoint_id=e.id AND d.audit_log_id=a.id)
  ORDER BY a.id
  LIMIT 500
  ON CONFLICT(endpoint_id,audit_log_id) DO NOTHING`);
}

export async function claimWebhookDelivery(id:string){
 const result=await db.query(`WITH candidate AS (
    SELECT d.id FROM webhook_deliveries d
    JOIN integration_endpoints e ON e.id=d.endpoint_id
    WHERE d.id=$1 AND d.status IN ('PENDING','PROCESSING')
      AND d.next_attempt_at<=now() AND d.attempts<10
      AND e.active=true AND e.integration_type='WEBHOOK'
    FOR UPDATE OF d SKIP LOCKED
   ), claimed AS (
    UPDATE webhook_deliveries d SET status='PROCESSING',claim_token=gen_random_uuid(),
      attempts=attempts+1,last_attempt_at=now(),next_attempt_at=now()+interval '5 minutes'
    FROM candidate c WHERE d.id=c.id RETURNING d.*
   )
   SELECT d.id,d.endpoint_id AS "endpointId",d.event_action AS "eventAction",d.payload,
     d.attempts,d.claim_token AS "claimToken",
     e.endpoint_url AS "endpointUrl",e.webhook_secret_ciphertext AS "secretCiphertext"
   FROM claimed d JOIN integration_endpoints e ON e.id=d.endpoint_id`,[id]);
 return result.rows[0] as any|undefined;
}

export async function deliverWebhookById(id:string){
 const item=await claimWebhookDelivery(id);
 if(!item)return {processed:false};
 try{
  const body=JSON.stringify(item.payload);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac("sha256",decryptApplicationSecret(String(item.secretCiphertext))).update(timestamp+"."+body).digest("hex");
  const response=await postWebhook(String(item.endpointUrl),body,{
     "content-type":"application/json","user-agent":"SIGDEC-Webhook/1.43",
     "x-sigdec-event":String(item.eventAction),"x-sigdec-delivery":String(item.id),
     "x-sigdec-timestamp":timestamp,"x-sigdec-signature":"sha256="+signature
  });
  const excerpt=response.excerpt;
  if(response.status<200||response.status>=300)throw Object.assign(new Error(`HTTP ${response.status}`),{status:response.status,excerpt});
  const settled=await db.query(`UPDATE webhook_deliveries SET status='SUCCEEDED',claim_token=NULL,
    delivered_at=now(),response_status=$2,response_excerpt=$3,last_error=NULL
    WHERE id=$1 AND status='PROCESSING' AND claim_token=$4`,[id,response.status,excerpt,item.claimToken]);
  if(!settled.rowCount)return {processed:false,stale:true};
  await db.query("UPDATE integration_endpoints SET last_delivery_at=now(),delivery_failure_count=0 WHERE id=$1",[item.endpointId]);
  return {processed:true,success:true,status:response.status};
 }catch(error:any){
  const attempts=Number(item.attempts??0);
  const terminal=attempts>=10;
  const delaySeconds=Math.min(3600,15*Math.pow(2,Math.max(0,attempts-1)));
  const settled=await db.query(`UPDATE webhook_deliveries SET status=$2,claim_token=NULL,
    next_attempt_at=now()+($3::text||' seconds')::interval,response_status=$4,response_excerpt=$5,last_error=$6
    WHERE id=$1 AND status='PROCESSING' AND claim_token=$7`,[
    id,terminal?"FAILED":"PENDING",delaySeconds,error?.status??null,error?.excerpt??null,
    error instanceof Error?error.message:String(error),item.claimToken
   ]);
  if(!settled.rowCount)return {processed:false,stale:true};
  await db.query("UPDATE integration_endpoints SET delivery_failure_count=delivery_failure_count+1 WHERE id=$1",[item.endpointId]);
  return {processed:true,success:false,terminal,error:error instanceof Error?error.message:String(error)};
 }
}

export async function dispatchWebhooks(){
 await enqueueWebhookEvents();
 await db.query(`UPDATE webhook_deliveries SET status='FAILED',claim_token=NULL,
   last_error='Entrega interrompida após atingir o limite de tentativas.'
   WHERE status='PROCESSING' AND attempts>=10 AND next_attempt_at<=now()`);
 const due=await db.query<{id:string}>(`SELECT id FROM webhook_deliveries
  WHERE status IN ('PENDING','PROCESSING') AND attempts<10
    AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20`);
 let success=0,failed=0;
 for(const row of due.rows){
  const r=await deliverWebhookById(row.id);
  if((r as any).success)success++;else if(r.processed)failed++;
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
 const deliveryId=inserted.rows[0]?.id;
 if(!deliveryId)throw new Error("Falha ao criar entrega de teste.");
 return deliverWebhookById(String(deliveryId));
}
