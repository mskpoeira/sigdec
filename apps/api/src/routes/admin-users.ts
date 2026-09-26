import {randomBytes} from "node:crypto";
import argon2 from "argon2";
import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,normalizeMatricula,requireAuth,requirePermission} from "../auth.js";
import {db} from "../db.js";

const uuid=z.string().uuid();
const userInput=z.object({
 matricula:z.string().trim().min(1).max(32),displayName:z.string().trim().min(3).max(160),
 email:z.union([z.string().trim().email().max(254),z.literal("")]).default(""),
 phone:z.string().trim().max(40).default(""),jobTitle:z.string().trim().max(120).default(""),
 department:z.string().trim().max(120).default(""),roleIds:z.array(uuid).min(1).max(8),
 active:z.boolean().default(true)
});
const roleInput=z.object({code:z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,59}$/),
 name:z.string().trim().min(3).max(120),permissionCodes:z.array(z.string()).max(100)});
const navigationPaths=["/painel","/ocorrencias","/ocorrencias/nova","/campo","/monitoramento","/assistencia",
 "/voluntarios","/vistorias","/comunicacoes","/sco","/documentos","/gestao","/continuidade","/administracao","/administracao/auditoria","/administracao/saude"] as const;
const navigationInput=z.object({label:z.string().trim().min(2).max(80),path:z.enum(navigationPaths),
 permissionCode:z.string().max(120).nullable().default(null),sortOrder:z.number().int().min(0).max(1000).default(100),active:z.boolean().default(true)});
const organization=(value:string|null)=>{if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return value};
const temporaryPassword=()=>randomBytes(20).toString("base64url")+"!Aa9";
const audit=async(client:any,request:FastifyRequest,action:string,entityType:string,entityId:string,before:unknown,after:unknown)=>{
 await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,[authFrom(request).userId,action,entityType,entityId,
  request.ip,request.headers["user-agent"]??null,JSON.stringify(before??null),JSON.stringify(after??null)]);
};
const userSelect=`SELECT u.id,u.matricula,u.display_name AS "displayName",u.email,u.phone,
 u.job_title AS "jobTitle",u.department,u.active,u.must_change_password AS "mustChangePassword",
 u.mfa_required AS "mfaRequired",u.mfa_enabled AS "mfaEnabled",u.last_login_at AS "lastLoginAt",
 u.created_at AS "createdAt",COALESCE(array_agg(r.id) FILTER(WHERE r.id IS NOT NULL),'{}') AS "roleIds",
 COALESCE(array_agg(r.code) FILTER(WHERE r.code IS NOT NULL),'{}') AS roles
 FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id`;

export async function adminUserRoutes(app:FastifyInstance){
 app.get("/api/v1/admin/users",{preHandler:requirePermission("system.master")},async request=>{
  const org=organization(authFrom(request).organizationId);
  const users=await db.query(`${userSelect} WHERE u.organization_id=$1 GROUP BY u.id ORDER BY u.display_name,u.id LIMIT 500`,[org]);
  return {items:users.rows};
 });
 app.get("/api/v1/admin/roles",{preHandler:requirePermission("system.master")},async()=>{
  const [roles,permissions]=await Promise.all([
   db.query(`SELECT r.id,r.code,r.name,r.level,r.system_role AS "systemRole",
    COALESCE(array_agg(p.code ORDER BY p.code) FILTER(WHERE p.code IS NOT NULL),'{}') AS "permissionCodes"
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
    GROUP BY r.id ORDER BY r.level DESC,r.name`),
   db.query("SELECT code,description FROM permissions ORDER BY code")
  ]);
  return {items:roles.rows,permissions:permissions.rows};
 });
 app.post("/api/v1/admin/roles",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const parsed=roleInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=parsed.data,code=v.code;
  if(code==="MASTER"||v.permissionCodes.includes("system.master"))return reply.code(403).send({error:"RESERVED_ROLE"});
  const client=await db.connect();try{await client.query("BEGIN");
   const unique=[...new Set(v.permissionCodes)];
   const valid=await client.query("SELECT code FROM permissions WHERE code=ANY($1::text[])",[unique]);
   if(valid.rowCount!==unique.length){await client.query("ROLLBACK");return reply.code(400).send({error:"UNKNOWN_PERMISSION"});}
   const role=await client.query<{id:string}>("INSERT INTO roles(code,name,level,system_role) VALUES($1,$2,20,false) RETURNING id",[code,v.name]);
   const id=role.rows[0]!.id;
   await client.query(`INSERT INTO role_permissions(role_id,permission_id)
    SELECT $1,id FROM permissions WHERE code=ANY($2::text[])`,[id,unique]);
   await audit(client,request,"ADMIN_ROLE_CREATED","role",id,null,{code,name:v.name,permissionCodes:unique});
   await client.query("COMMIT");return reply.code(201).send({id});
  }catch(error:any){await client.query("ROLLBACK");if(error.code==="23505")return reply.code(409).send({error:"ROLE_EXISTS"});throw error}finally{client.release()}
 });
 app.put("/api/v1/admin/roles/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const {id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const parsed=roleInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=parsed.data;if(v.code==="MASTER"||v.permissionCodes.includes("system.master"))return reply.code(403).send({error:"RESERVED_ROLE"});
  const client=await db.connect();try{await client.query("BEGIN");
   const prior=await client.query("SELECT id,code,name FROM roles WHERE id=$1 AND system_role=false FOR UPDATE",[id]);
   if(!prior.rows[0]){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}
   const unique=[...new Set(v.permissionCodes)];
   const valid=await client.query("SELECT code FROM permissions WHERE code=ANY($1::text[])",[unique]);
   if(valid.rowCount!==unique.length){await client.query("ROLLBACK");return reply.code(400).send({error:"UNKNOWN_PERMISSION"});}
   await client.query("UPDATE roles SET code=$2,name=$3 WHERE id=$1",[id,v.code,v.name]);
   await client.query("DELETE FROM role_permissions WHERE role_id=$1",[id]);
   await client.query(`INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[])`,[id,unique]);
   await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_id=$1) AND revoked_at IS NULL",[id]);
   await audit(client,request,"ADMIN_ROLE_UPDATED","role",id,prior.rows[0],{code:v.code,name:v.name,permissionCodes:unique});
   await client.query("COMMIT");return {id};
  }catch(error:any){await client.query("ROLLBACK");if(error.code==="23505")return reply.code(409).send({error:"ROLE_EXISTS"});throw error}finally{client.release()}
 });
 async function validateRoles(client:any,roleIds:string[]){
  const unique=[...new Set(roleIds)];
  const found=await client.query("SELECT id,code,level FROM roles WHERE id=ANY($1::uuid[])",[unique]);
  return found.rowCount===unique.length?{unique,rows:found.rows}:null;
 }
 app.post("/api/v1/admin/users",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const org=organization(authFrom(request).organizationId),parsed=userInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data,matricula=normalizeMatricula(v.matricula);
  if(!matricula)return reply.code(400).send({error:"INVALID_MATRICULA"});
  const password=temporaryPassword(),hash=await argon2.hash(password,{type:argon2.argon2id});
  const client=await db.connect();try{await client.query("BEGIN");
   const roles=await validateRoles(client,v.roleIds);
   if(!roles){await client.query("ROLLBACK");return reply.code(400).send({error:"INVALID_ROLES"});}
   const mfa=roles.rows.some((r:any)=>r.code==="MASTER"||r.level>=80);
   const result=await client.query<{id:string}>(`INSERT INTO users(organization_id,matricula,display_name,email,phone,job_title,department,
    password_hash,active,must_change_password,mfa_required)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING id`,[
    org,matricula,v.displayName,v.email||null,v.phone||null,v.jobTitle||null,v.department||null,hash,v.active,mfa]);
   const id=result.rows[0]!.id;
   await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,unnest($2::uuid[])",[id,roles.unique]);
   await audit(client,request,"ADMIN_USER_CREATED","user",id,null,{matricula,displayName:v.displayName,active:v.active,roles:roles.rows.map((r:any)=>r.code)});
   await client.query("COMMIT");return reply.code(201).send({id,temporaryPassword:password});
  }catch(error:any){await client.query("ROLLBACK");if(error.code==="23505")return reply.code(409).send({error:"MATRICULA_EXISTS"});throw error}finally{client.release()}
 });
 app.put("/api/v1/admin/users/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const {id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const org=organization(authFrom(request).organizationId),parsed=userInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const v=parsed.data,matricula=normalizeMatricula(v.matricula);
  if(!matricula)return reply.code(400).send({error:"INVALID_MATRICULA"});
  const client=await db.connect();try{await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[org]);
   const before=await client.query("SELECT id,matricula,display_name,active FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE",[id,org]);
   if(!before.rows[0]){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}
   const roles=await validateRoles(client,v.roleIds);
   if(!roles){await client.query("ROLLBACK");return reply.code(400).send({error:"INVALID_ROLES"});}
   const original=await client.query("SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1",[id]);
   const hadMaster=original.rows.some((r:any)=>r.code==="MASTER");
   const hasMaster=roles.rows.some((r:any)=>r.code==="MASTER");
   if(id===authFrom(request).userId&&(!v.active||!hasMaster)){
    await client.query("ROLLBACK");return reply.code(409).send({error:"CANNOT_REMOVE_OWN_ACCESS"});
   }
   if(hadMaster&&(!v.active||!hasMaster)){
    const masters=await client.query(`SELECT count(DISTINCT u.id)::int AS count FROM users u JOIN user_roles ur ON ur.user_id=u.id
     JOIN roles r ON r.id=ur.role_id WHERE u.organization_id=$1 AND u.active=true AND r.code='MASTER'`,[org]);
    if(Number(masters.rows[0]?.count??0)<=1){await client.query("ROLLBACK");return reply.code(409).send({error:"LAST_MASTER"});}
   }
   const mfa=roles.rows.some((r:any)=>r.code==="MASTER"||r.level>=80);
   await client.query(`UPDATE users SET matricula=$3,display_name=$4,email=$5,phone=$6,job_title=$7,department=$8,
    active=$9,mfa_required=CASE WHEN $10 THEN true ELSE mfa_required END,updated_at=now()
    WHERE id=$1 AND organization_id=$2`,[id,org,matricula,v.displayName,v.email||null,v.phone||null,v.jobTitle||null,v.department||null,v.active,mfa]);
   await client.query("DELETE FROM user_roles WHERE user_id=$1",[id]);
   await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,unnest($2::uuid[])",[id,roles.unique]);
   await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[id]);
   await audit(client,request,"ADMIN_USER_UPDATED","user",id,{...before.rows[0],roles:original.rows.map((r:any)=>r.code)},
    {matricula,displayName:v.displayName,active:v.active,roles:roles.rows.map((r:any)=>r.code)});
   await client.query("COMMIT");return {id};
  }catch(error:any){await client.query("ROLLBACK");if(error.code==="23505")return reply.code(409).send({error:"MATRICULA_EXISTS"});throw error}finally{client.release()}
 });
 app.post("/api/v1/admin/users/:id/reset-password",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const {id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const org=organization(authFrom(request).organizationId),password=temporaryPassword();
  const hash=await argon2.hash(password,{type:argon2.argon2id});
  const client=await db.connect();try{await client.query("BEGIN");
   const result=await client.query("UPDATE users SET password_hash=$3,must_change_password=true,failed_login_attempts=0,locked_until=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id",[id,org,hash]);
   if(!result.rows[0]){await client.query("ROLLBACK");return reply.code(404).send({error:"NOT_FOUND"});}
   await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[id]);
   await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",[id]);
   await audit(client,request,"ADMIN_PASSWORD_RESET","user",id,null,{mustChangePassword:true});
   await client.query("COMMIT");return {temporaryPassword:password};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
 });

 app.get("/api/v1/navigation",{preHandler:requireAuth},async request=>{
  const auth=authFrom(request),org=organization(auth.organizationId);
  const result=await db.query(`SELECT n.id,n.label,n.path,n.sort_order AS "sortOrder" FROM navigation_items n
   WHERE n.organization_id=$1 AND n.active=true
    AND (n.path<>'/administracao' OR EXISTS(
     SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id
     JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id
     WHERE u.id=$2 AND u.active=true AND p.code='system.master'))
    AND (n.permission_code IS NULL OR EXISTS(
     SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id
     JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id
     WHERE u.id=$2 AND u.active=true AND p.code=n.permission_code)) ORDER BY n.sort_order,n.label`,[org,auth.userId]);
  return {items:result.rows};
 });
 app.get("/api/v1/admin/navigation",{preHandler:requirePermission("system.master")},async request=>{
  const org=organization(authFrom(request).organizationId);
  const result=await db.query(`SELECT id,label,path,permission_code AS "permissionCode",sort_order AS "sortOrder",active
    FROM navigation_items WHERE organization_id=$1 ORDER BY sort_order,label`,[org]);return {items:result.rows};
 });
 app.post("/api/v1/admin/navigation",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const org=organization(authFrom(request).organizationId),parsed=navigationInput.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});const v=parsed.data;
  const result=await db.query(`INSERT INTO navigation_items(organization_id,label,path,permission_code,sort_order,active)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[org,v.label,v.path,v.permissionCode||null,v.sortOrder,v.active]);
  await audit(db,request,"ADMIN_NAVIGATION_CREATED","navigation_item",result.rows[0].id,null,v);
  return reply.code(201).send(result.rows[0]);
 });
 app.put("/api/v1/admin/navigation/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const org=organization(authFrom(request).organizationId),{id}=request.params as {id:string},parsed=navigationInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});const v=parsed.data;
  const prior=await db.query("SELECT label,path,active FROM navigation_items WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!prior.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  await db.query(`UPDATE navigation_items SET label=$3,path=$4,permission_code=$5,sort_order=$6,active=$7,updated_at=now()
    WHERE id=$1 AND organization_id=$2`,[id,org,v.label,v.path,v.permissionCode||null,v.sortOrder,v.active]);
  await audit(db,request,"ADMIN_NAVIGATION_UPDATED","navigation_item",id,prior.rows[0],v);return {id};
 });
 app.delete("/api/v1/admin/navigation/:id",{preHandler:requirePermission("system.master")},async(request,reply)=>{
  const org=organization(authFrom(request).organizationId),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const result=await db.query("DELETE FROM navigation_items WHERE id=$1 AND organization_id=$2 RETURNING label,path",[id,org]);
  if(!result.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  await audit(db,request,"ADMIN_NAVIGATION_DELETED","navigation_item",id,result.rows[0],null);return {ok:true};
 });
}
