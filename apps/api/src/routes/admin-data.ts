import type {FastifyInstance,FastifyRequest} from "fastify";
import {createHash} from "node:crypto";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";
import {signAuditCheckpoint,verifyAuditCheckpoint} from "../lib/sidec-asymmetric.js";

const uuid=z.string().uuid();
const itemInput=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(2).max(200),
 unit:z.string().trim().min(1).max(30),category:z.string().trim().min(1).max(50),active:z.boolean()});
const org=(request:FastifyRequest)=>{const value=authFrom(request).organizationId;if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return value};
const audit=async(request:FastifyRequest,action:string,id:string,before:unknown,after:unknown)=>{
 await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
  VALUES($1,$2,'humanitarian_item',$3,$4,$5,$6::jsonb,$7::jsonb)`,[authFrom(request).userId,action,id,request.ip,
  request.headers["user-agent"]??null,JSON.stringify(before??null),JSON.stringify(after??null)]);
};
const auditQuery=z.object({
 matricula:z.string().trim().max(32).optional(),
 action:z.string().trim().max(120).optional(),
 entityType:z.string().trim().max(120).optional(),
 from:z.coerce.date().optional(),
 to:z.coerce.date().optional(),
 limit:z.coerce.number().int().min(1).max(500).default(100)
});
const csvCell=(value:unknown)=>{
 const plain=String(value??"").replace(/\r|\n/g," ");
 const safe=/^[=+\-@]/.test(plain)?"'"+plain:plain;
 return '"'+safe.replace(/"/g,'""')+'"';
};

const sha256=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const checkpointCanonical=(value:{organizationId:string;createdAt:string;matricula:string;auditCount:number;firstAuditId:string|null;lastAuditId:string|null;auditRootHash:string;previousCheckpointHash:string|null;integrityVersion:number})=>
 [value.integrityVersion,value.organizationId,value.createdAt,value.matricula,value.auditCount,value.firstAuditId??"",value.lastAuditId??"",value.auditRootHash,value.previousCheckpointHash??""].join("\n");

async function computeAuditRoot(organizationId:string,maxAuditId?:string|null){
 const hash=createHash("sha256");
 let cursor="0",count=0,firstAuditId:string|null=null,lastAuditId:string|null=null,invalid=0,unsealed=0;
 while(true){
  const values:unknown[]=[organizationId,cursor];
  let upper="";
  if(maxAuditId){values.push(maxAuditId);upper=` AND a.id<=${values.length}`;}
  const result=await db.query(`SELECT a.id::text AS id,a.integrity_hash AS "integrityHash",
    (a.integrity_hash IS NOT NULL AND a.integrity_hash=sigdec_calculate_audit_hash(a)) AS "integrityValid"
    FROM audit_logs a JOIN users u ON u.id=a.actor_user_id
    WHERE u.organization_id=$1 AND a.id>$2${upper}
    ORDER BY a.id ASC LIMIT 5000`,values);
  if(!result.rows.length)break;
  for(const row of result.rows){
   if(firstAuditId===null)firstAuditId=row.id;
   lastAuditId=row.id;cursor=row.id;count+=1;
   if(!row.integrityHash)unsealed+=1;
   else if(!row.integrityValid)invalid+=1;
   hash.update(`${row.id}:${row.integrityHash??"UNSEALED"}\n`,"utf8");
  }
  if(result.rows.length<5000)break;
 }
 return {auditRootHash:hash.digest("hex"),auditCount:count,firstAuditId,lastAuditId,invalid,unsealed};
}

export async function adminDataRoutes(app:FastifyInstance){
 app.post("/api/v1/admin/items",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const parsed=itemInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data;
  try{
   const result=await db.query(`INSERT INTO humanitarian_items(organization_id,code,name,unit,category,active)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id,code,name,unit,category,active`,
    [org(request),v.code,v.name,v.unit,v.category,v.active]);
   await audit(request,"ADMIN_ITEM_CREATED",result.rows[0].id,null,result.rows[0]);
   return reply.code(201).send(result.rows[0]);
  }catch(error:any){if(error.code==="23505")return reply.code(409).send({error:"ITEM_CODE_EXISTS"});throw error}
 });
 app.get("/api/v1/admin/items",{preHandler:requirePermission("system.master")},async request=>{
  const result=await db.query(`SELECT i.id,i.code,i.name,i.unit,i.category,i.active,i.created_at AS "createdAt",
   COALESCE(sum(CASE WHEN m.movement_type IN ('IN','ADJUST_IN') THEN m.quantity ELSE -m.quantity END),0)::float8 AS balance,
   count(m.id)::int AS "movementCount"
   FROM humanitarian_items i LEFT JOIN humanitarian_stock_movements m ON m.item_id=i.id AND m.organization_id=i.organization_id
   WHERE i.organization_id=$1 GROUP BY i.id ORDER BY i.name LIMIT 500`,[org(request)]);
  return {items:result.rows};
 });
 app.put("/api/v1/admin/items/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const {id}=request.params as {id:string},parsed=itemInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=parsed.data,organizationId=org(request);
  const before=await db.query(`SELECT i.code,i.name,i.unit,i.category,i.active,
   EXISTS(SELECT 1 FROM humanitarian_stock_movements m WHERE m.item_id=i.id) AS "hasMovements"
   FROM humanitarian_items i WHERE i.id=$1 AND i.organization_id=$2`,[id,organizationId]);
  if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  if(before.rows[0].hasMovements&&v.unit!==before.rows[0].unit)return reply.code(409).send({error:"UNIT_HAS_HISTORY",message:"A unidade não pode mudar após movimentações."});
  try{
   const result=await db.query(`UPDATE humanitarian_items SET code=$3,name=$4,unit=$5,category=$6,active=$7
    WHERE id=$1 AND organization_id=$2 RETURNING id,code,name,unit,category,active`,[id,organizationId,v.code,v.name,v.unit,v.category,v.active]);
   await audit(request,"ADMIN_ITEM_UPDATED",id,before.rows[0],result.rows[0]);return result.rows[0];
  }catch(error:any){if(error.code==="23505")return reply.code(409).send({error:"ITEM_CODE_EXISTS"});throw error}
 });
 app.delete("/api/v1/admin/items/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const {id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const result=await db.query("UPDATE humanitarian_items SET active=false WHERE id=$1 AND organization_id=$2 RETURNING id,code,name",[id,org(request)]);
  if(!result.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  await audit(request,"ADMIN_ITEM_DEACTIVATED",id,{active:true},result.rows[0]);return {ok:true};
 });

 app.get("/api/v1/admin/audit",{preHandler:requirePermission("audit.read")},async(request,reply)=>{
  const parsed=auditQuery.safeParse(request.query??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_QUERY",details:parsed.error.flatten()});
  const q=parsed.data,values:unknown[]=[org(request)],where=["u.organization_id=$1"];
  if(q.matricula){values.push(`%${q.matricula}%`);where.push(`a.actor_matricula ILIKE $${values.length}`);}
  if(q.action){values.push(`%${q.action}%`);where.push(`a.action ILIKE $${values.length}`);}
  if(q.entityType){values.push(`%${q.entityType}%`);where.push(`a.entity_type ILIKE $${values.length}`);}
  if(q.from){values.push(q.from);where.push(`a.occurred_at >= $${values.length}`);}
  if(q.to){values.push(q.to);where.push(`a.occurred_at <= $${values.length}`);}
  values.push(q.limit);
  const result=await db.query(`SELECT a.id,a.occurred_at AS "occurredAt",a.actor_matricula AS "actorMatricula",
    u.display_name AS "actorName",a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",
    a.ip::text AS ip,a.metadata,a.integrity_version AS "integrityVersion",a.integrity_hash AS "integrityHash",
    (a.integrity_hash=sigdec_calculate_audit_hash(a)) AS "integrityValid"
    FROM audit_logs a JOIN users u ON u.id=a.actor_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.occurred_at DESC,a.id DESC LIMIT $${values.length}`,values);
  return {items:result.rows,filters:q};
 });
 app.get("/api/v1/admin/audit.csv",{preHandler:requirePermission("audit.read")},async(request,reply)=>{
  const parsed=auditQuery.safeParse(request.query??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_QUERY"});
  const q=parsed.data,values:unknown[]=[org(request)],where=["u.organization_id=$1"];
  if(q.matricula){values.push(`%${q.matricula}%`);where.push(`a.actor_matricula ILIKE $${values.length}`);}
  if(q.action){values.push(`%${q.action}%`);where.push(`a.action ILIKE $${values.length}`);}
  if(q.entityType){values.push(`%${q.entityType}%`);where.push(`a.entity_type ILIKE $${values.length}`);}
  if(q.from){values.push(q.from);where.push(`a.occurred_at >= $${values.length}`);}
  if(q.to){values.push(q.to);where.push(`a.occurred_at <= $${values.length}`);}
  const result=await db.query(`SELECT to_char(a.occurred_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS') AS horario,
    a.actor_matricula AS matricula,u.display_name AS servidor,a.action,a.entity_type,a.entity_id,a.ip::text AS ip,
    a.metadata::text AS metadata,a.integrity_version,a.integrity_hash,
    CASE WHEN a.integrity_hash=sigdec_calculate_audit_hash(a) THEN 'OK' ELSE 'FALHA' END AS integridade
    FROM audit_logs a JOIN users u ON u.id=a.actor_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.occurred_at DESC,a.id DESC LIMIT 500`,values);
  const header=["Horário","Matrícula","Servidor","Ação","Tipo","Registro","IP","Metadados","Versão de integridade","SHA-256","Integridade"];
  const rows=result.rows.map(x=>[x.horario,x.matricula,x.servidor,x.action,x.entity_type,x.entity_id,x.ip,x.metadata,x.integrity_version,x.integrity_hash,x.integridade]);
  reply.header("content-type","text/csv; charset=utf-8").header("content-disposition",'attachment; filename="sigdec-auditoria.csv"')
   .header("cache-control","no-store");
  return "\uFEFF"+[header,...rows].map(row=>row.map(csvCell).join(";")).join("\r\n")+"\r\n";
 });

 app.get("/api/v1/admin/audit/verify",{preHandler:requirePermission("audit.read")},async request=>{
  const organizationId=org(request);
  const result=await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE a.integrity_hash IS NULL)::int AS unsealed,
    count(*) FILTER(WHERE a.integrity_hash IS NOT NULL AND a.integrity_hash<>sigdec_calculate_audit_hash(a))::int AS invalid,
    min(a.occurred_at) AS "oldestAt",max(a.occurred_at) AS "newestAt"
    FROM audit_logs a
    JOIN users u ON u.id=a.actor_user_id
    WHERE u.organization_id=$1`,[organizationId]);
  const row=result.rows[0]??{total:0,unsealed:0,invalid:0,oldestAt:null,newestAt:null};
  return {
   status:Number(row.unsealed)===0&&Number(row.invalid)===0?"verified":"failed",
   algorithm:"SHA-256",
   appendOnly:true,
   checkedAt:new Date().toISOString(),
   ...row
  };
 });

 app.get("/api/v1/admin/audit/checkpoints",{preHandler:requirePermission("audit.read")},async(request,reply)=>{
  const parsed=z.object({limit:z.coerce.number().int().min(1).max(100).default(20)}).safeParse(request.query??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_QUERY"});
  const result=await db.query(`SELECT c.id::text AS id,c.created_at AS "createdAt",c.created_by_matricula AS "createdByMatricula",
    u.display_name AS "createdByName",c.audit_count::int AS "auditCount",c.first_audit_id::text AS "firstAuditId",
    c.last_audit_id::text AS "lastAuditId",c.audit_root_hash AS "auditRootHash",
    c.previous_checkpoint_hash AS "previousCheckpointHash",c.checkpoint_hash AS "checkpointHash",
    c.integrity_version AS "integrityVersion",c.algorithm
    FROM audit_integrity_checkpoints c JOIN users u ON u.id=c.created_by
    WHERE c.organization_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT $2`,[org(request),parsed.data.limit]);
  const items=result.rows.map(row=>{
   const expected=sha256(checkpointCanonical({
    organizationId:org(request),createdAt:new Date(row.createdAt).toISOString(),matricula:row.createdByMatricula,
    auditCount:Number(row.auditCount),firstAuditId:row.firstAuditId,lastAuditId:row.lastAuditId,
    auditRootHash:row.auditRootHash,previousCheckpointHash:row.previousCheckpointHash,integrityVersion:Number(row.integrityVersion)
   }));
   return {...row,checkpointValid:expected===row.checkpointHash};
  });
  return {items};
 });

 app.post("/api/v1/admin/audit/checkpoints",{preHandler:requirePermission("audit.checkpoint")},async(request,reply)=>{
  const auth=authFrom(request),organizationId=org(request);
  const integrity=await computeAuditRoot(organizationId);
  if(integrity.invalid>0||integrity.unsealed>0){
   return reply.code(409).send({error:"AUDIT_INTEGRITY_FAILED",message:"A trilha possui registros inválidos ou sem selo.",...integrity});
  }
  const [actor,clock,previous]=await Promise.all([
   db.query("SELECT matricula FROM users WHERE id=$1 AND organization_id=$2",[auth.userId,organizationId]),
   db.query("SELECT now() AS now"),
   db.query("SELECT checkpoint_hash FROM audit_integrity_checkpoints WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[organizationId])
  ]);
  if(!actor.rows[0])return reply.code(409).send({error:"ACTOR_NOT_FOUND"});
  const createdAt=new Date(clock.rows[0].now).toISOString(),matricula=String(actor.rows[0].matricula);
  const previousCheckpointHash=previous.rows[0]?.checkpoint_hash??null,integrityVersion=1;
  const checkpointHash=sha256(checkpointCanonical({
   organizationId,createdAt,matricula,auditCount:integrity.auditCount,firstAuditId:integrity.firstAuditId,
   lastAuditId:integrity.lastAuditId,auditRootHash:integrity.auditRootHash,previousCheckpointHash,integrityVersion
  }));
  try{
   const result=await db.query(`INSERT INTO audit_integrity_checkpoints(
     organization_id,created_at,created_by,created_by_matricula,audit_count,first_audit_id,last_audit_id,
     audit_root_hash,previous_checkpoint_hash,checkpoint_hash,integrity_version,algorithm,metadata
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SHA-256',$12::jsonb)
    RETURNING id::text AS id,created_at AS "createdAt",created_by_matricula AS "createdByMatricula",
     audit_count::int AS "auditCount",first_audit_id::text AS "firstAuditId",last_audit_id::text AS "lastAuditId",
     audit_root_hash AS "auditRootHash",previous_checkpoint_hash AS "previousCheckpointHash",
     checkpoint_hash AS "checkpointHash",integrity_version AS "integrityVersion",algorithm`,[
    organizationId,createdAt,auth.userId,matricula,integrity.auditCount,integrity.firstAuditId,integrity.lastAuditId,
    integrity.auditRootHash,previousCheckpointHash,checkpointHash,integrityVersion,JSON.stringify({invalid:0,unsealed:0})
   ]);
   return reply.code(201).send({...result.rows[0],checkpointValid:true});
  }catch(error:any){
   if(error?.code==="23505")return reply.code(409).send({error:"CHECKPOINT_CONFLICT",message:"Outro checkpoint foi criado simultaneamente. Atualize a tela e tente novamente."});
   throw error;
  }
 });

 app.get("/api/v1/admin/audit/checkpoints/verify",{preHandler:requirePermission("audit.read")},async request=>{
  const organizationId=org(request);
  const all=await db.query(`SELECT c.id::text AS id,c.created_at AS "createdAt",c.created_by_matricula AS "createdByMatricula",
    c.audit_count::int AS "auditCount",c.first_audit_id::text AS "firstAuditId",c.last_audit_id::text AS "lastAuditId",
    c.audit_root_hash AS "auditRootHash",c.previous_checkpoint_hash AS "previousCheckpointHash",
    c.checkpoint_hash AS "checkpointHash",c.integrity_version AS "integrityVersion",c.algorithm
    FROM audit_integrity_checkpoints c WHERE c.organization_id=$1 ORDER BY c.created_at ASC,c.id ASC`,[organizationId]);
  if(!all.rows.length)return {status:"none",message:"Nenhum ponto de verificação criado.",checkedAt:new Date().toISOString(),checkpointCount:0};
  let previousHash:string|null=null,chainInvalid=0,contentInvalid=0;
  for(const row of all.rows){
   const expected=sha256(checkpointCanonical({
    organizationId,createdAt:new Date(row.createdAt).toISOString(),matricula:row.createdByMatricula,
    auditCount:Number(row.auditCount),firstAuditId:row.firstAuditId,lastAuditId:row.lastAuditId,
    auditRootHash:row.auditRootHash,previousCheckpointHash:row.previousCheckpointHash,integrityVersion:Number(row.integrityVersion)
   }));
   if(expected!==row.checkpointHash)contentInvalid+=1;
   if((row.previousCheckpointHash??null)!==previousHash)chainInvalid+=1;
   previousHash=row.checkpointHash;
  }
  const latest=all.rows[all.rows.length-1],audit=await computeAuditRoot(organizationId,latest.lastAuditId);
  const rootValid=audit.auditRootHash===latest.auditRootHash&&audit.auditCount===Number(latest.auditCount)&&
   audit.firstAuditId===latest.firstAuditId&&audit.lastAuditId===latest.lastAuditId;
  const status=rootValid&&audit.invalid===0&&audit.unsealed===0&&chainInvalid===0&&contentInvalid===0?"verified":"failed";
  return {
   status,checkedAt:new Date().toISOString(),checkpointCount:all.rows.length,chainInvalid,contentInvalid,
   latest:{...latest,checkpointValid:contentInvalid===0&&chainInvalid===0},
   audit:{...audit,rootValid}
  };
 });

 app.get("/api/v1/admin/audit/checkpoints/:id/receipt",{preHandler:requirePermission("audit.read")},async(request,reply)=>{
  const organizationId=org(request),{id}=request.params as {id:string};
  if(!/^\d+$/.test(id))return reply.code(400).send({error:"INVALID_CHECKPOINT_ID"});
  const result=await db.query(`SELECT c.id::text AS id,c.created_at AS "createdAt",c.created_by_matricula AS "createdByMatricula",
    u.display_name AS "createdByName",o.id::text AS "organizationId",o.name AS "organizationName",
    c.audit_count::int AS "auditCount",c.first_audit_id::text AS "firstAuditId",c.last_audit_id::text AS "lastAuditId",
    c.audit_root_hash AS "auditRootHash",c.previous_checkpoint_hash AS "previousCheckpointHash",
    c.checkpoint_hash AS "checkpointHash",c.integrity_version AS "integrityVersion",c.algorithm
    FROM audit_integrity_checkpoints c JOIN users u ON u.id=c.created_by JOIN organizations o ON o.id=c.organization_id
    WHERE c.id=$1 AND c.organization_id=$2`,[id,organizationId]);
  const row=result.rows[0];
  if(!row)return reply.code(404).send({error:"CHECKPOINT_NOT_FOUND"});
  const checkpointValid=sha256(checkpointCanonical({
   organizationId:row.organizationId,createdAt:new Date(row.createdAt).toISOString(),matricula:row.createdByMatricula,
   auditCount:Number(row.auditCount),firstAuditId:row.firstAuditId,lastAuditId:row.lastAuditId,
   auditRootHash:row.auditRootHash,previousCheckpointHash:row.previousCheckpointHash,integrityVersion:Number(row.integrityVersion)
  }))===row.checkpointHash;
  const audit=await computeAuditRoot(organizationId,row.lastAuditId);
  const rootValid=audit.auditRootHash===row.auditRootHash&&audit.auditCount===Number(row.auditCount)&&
   audit.firstAuditId===row.firstAuditId&&audit.lastAuditId===row.lastAuditId;
  const receipt={
   proofVersion:"sigdec-audit-checkpoint/1.0",
   generatedAt:new Date().toISOString(),
   checkpoint:{
    id:row.id,organizationId:row.organizationId,organizationName:row.organizationName,
    createdAt:new Date(row.createdAt).toISOString(),createdByMatricula:row.createdByMatricula,createdByName:row.createdByName,
    auditCount:Number(row.auditCount),firstAuditId:row.firstAuditId,lastAuditId:row.lastAuditId,
    auditRootHash:row.auditRootHash,previousCheckpointHash:row.previousCheckpointHash,
    checkpointHash:row.checkpointHash,integrityVersion:Number(row.integrityVersion),algorithm:row.algorithm
   },
   verification:{checkpointValid,rootValid,invalid:audit.invalid,unsealed:audit.unsealed,valid:checkpointValid&&rootValid&&audit.invalid===0&&audit.unsealed===0},
   publicVerificationPath:`/integridade/auditoria/${row.checkpointHash}`
  };
  reply.header("content-type","application/json; charset=utf-8")
   .header("content-disposition",`attachment; filename="sigdec-audit-checkpoint-${row.id}.json"`)
   .header("cache-control","no-store");
  return receipt;
 });

 app.get("/api/v1/public/audit-checkpoint/:hash",async(request,reply)=>{
  const {hash}=request.params as {hash:string};
  if(!/^[a-f0-9]{64}$/i.test(hash))return reply.code(400).send({error:"INVALID_CHECKPOINT_HASH"});
  const result=await db.query(`SELECT c.id::text AS id,c.organization_id::text AS "organizationId",o.name AS "organizationName",
    c.created_at AS "createdAt",c.created_by_matricula AS "createdByMatricula",
    c.audit_count::int AS "auditCount",c.first_audit_id::text AS "firstAuditId",c.last_audit_id::text AS "lastAuditId",
    c.audit_root_hash AS "auditRootHash",c.previous_checkpoint_hash AS "previousCheckpointHash",
    c.checkpoint_hash AS "checkpointHash",c.integrity_version AS "integrityVersion",c.algorithm
    FROM audit_integrity_checkpoints c JOIN organizations o ON o.id=c.organization_id
    WHERE c.checkpoint_hash=$1 LIMIT 1`,[hash.toLowerCase()]);
  const row=result.rows[0];
  if(!row)return reply.code(404).send({error:"CHECKPOINT_NOT_FOUND"});
  const expected=sha256(checkpointCanonical({
   organizationId:row.organizationId,createdAt:new Date(row.createdAt).toISOString(),matricula:row.createdByMatricula,
   auditCount:Number(row.auditCount),firstAuditId:row.firstAuditId,lastAuditId:row.lastAuditId,
   auditRootHash:row.auditRootHash,previousCheckpointHash:row.previousCheckpointHash,integrityVersion:Number(row.integrityVersion)
  }));
  const audit=await computeAuditRoot(row.organizationId,row.lastAuditId);
  const rootValid=audit.auditRootHash===row.auditRootHash&&audit.auditCount===Number(row.auditCount)&&
   audit.firstAuditId===row.firstAuditId&&audit.lastAuditId===row.lastAuditId;
  const checkpointValid=expected===row.checkpointHash;
  const previousExists=row.previousCheckpointHash?Boolean((await db.query(
   "SELECT 1 FROM audit_integrity_checkpoints WHERE organization_id=$1 AND checkpoint_hash=$2",[row.organizationId,row.previousCheckpointHash]
  )).rows[0]):true;
  return {
   valid:checkpointValid&&rootValid&&previousExists&&audit.invalid===0&&audit.unsealed===0,
   proofVersion:"sigdec-audit-checkpoint-public/1.0",
   organizationName:row.organizationName,
   createdAt:row.createdAt,
   auditCount:Number(row.auditCount),
   firstAuditId:row.firstAuditId,
   lastAuditId:row.lastAuditId,
   auditRootHash:row.auditRootHash,
   previousCheckpointHash:row.previousCheckpointHash,
   checkpointHash:row.checkpointHash,
   integrityVersion:Number(row.integrityVersion),
   algorithm:row.algorithm,
   verification:{checkpointValid,rootValid,previousExists,invalid:audit.invalid,unsealed:audit.unsealed},
   checkedAt:new Date().toISOString()
  };
 });

 app.get("/api/v1/admin/reports/users",{preHandler:requirePermission("system.master")},async request=>{
  const o=org(request);
  const [overview,roles]=await Promise.all([
   db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active,
    count(*) FILTER(WHERE NOT active)::int AS inactive,
    count(*) FILTER(WHERE must_change_password)::int AS "pendingPasswordChange",
    count(*) FILTER(WHERE mfa_enabled)::int AS "mfaEnabled"
    FROM users WHERE organization_id=$1`,[o]),
   db.query(`SELECT r.code,r.name,count(u.id)::int AS total,
    count(u.id) FILTER(WHERE u.active)::int AS active
    FROM roles r LEFT JOIN user_roles ur ON ur.role_id=r.id
    LEFT JOIN users u ON u.id=ur.user_id AND u.organization_id=$1 GROUP BY r.id ORDER BY r.name`,[o])
  ]);
  return {overview:overview.rows[0],roles:roles.rows};
 });
 app.get("/api/v1/admin/reports/users.csv",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const result=await db.query(`SELECT u.matricula,u.display_name,u.email,u.department,u.active,
   u.must_change_password,u.last_login_at,COALESCE(string_agg(r.code,', ' ORDER BY r.code),'') AS roles
   FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
   WHERE u.organization_id=$1 GROUP BY u.id ORDER BY u.display_name LIMIT 5000`,[org(request)]);
  const header=["Matrícula","Nome","E-mail","Setor","Ativo","Troca de senha","Último acesso","Perfis"];
  const rows=result.rows.map(x=>[x.matricula,x.display_name,x.email,x.department,x.active?"Sim":"Não",
   x.must_change_password?"Sim":"Não",x.last_login_at?new Date(x.last_login_at).toISOString():"",x.roles]);
  reply.header("content-type","text/csv; charset=utf-8").header("content-disposition",'attachment; filename="sigdec-usuarios.csv"')
   .header("cache-control","no-store");
  return "\uFEFF"+[header,...rows].map(row=>row.map(csvCell).join(";")).join("\r\n")+"\r\n";
 });

 // Fixed, redacted views only. No client-supplied SQL or access to secrets/medical records.
 const views={
  users:`SELECT id,matricula,display_name,email,active,created_at,last_login_at FROM users WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`,
  inventory:`SELECT id,code,name,unit,category,active,created_at FROM humanitarian_items WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`,
  incidents:`SELECT id,protocol,status,priority,created_at FROM incidents WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`,
  navigation:`SELECT id,label,path,active,sort_order FROM navigation_items WHERE organization_id=$1 ORDER BY sort_order LIMIT $2`,
  audit:`SELECT a.id,a.occurred_at,a.actor_matricula,a.action,a.entity_type,a.entity_id,a.metadata FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE COALESCE(u.organization_id,(SELECT organization_id FROM users WHERE id=a.actor_user_id))=$1 ORDER BY a.id DESC LIMIT $2`
 } as const;
 app.get("/api/v1/admin/database",{preHandler:requirePermission("system.master")},async request=>{
  const query=z.object({view:z.enum(["users","inventory","incidents","navigation","audit"]),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(request.query);
  if(!query.success)return {error:"INVALID_INPUT"};
  const rows=await db.query(views[query.data.view],[org(request),query.data.limit]);
  return {view:query.data.view,items:rows.rows,readOnly:true};
 });
}
