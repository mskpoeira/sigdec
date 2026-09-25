import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";

const uuid=z.string().uuid();
const itemInput=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(2).max(200),
 unit:z.string().trim().min(1).max(30),category:z.string().trim().min(1).max(50),active:z.boolean()});
const org=(request:FastifyRequest)=>{const value=authFrom(request).organizationId;if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});return value};
const audit=async(request:FastifyRequest,action:string,id:string,before:unknown,after:unknown)=>{
 await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
  VALUES($1,$2,'humanitarian_item',$3,$4,$5,$6::jsonb,$7::jsonb)`,[authFrom(request).userId,action,id,request.ip,
  request.headers["user-agent"]??null,JSON.stringify(before??null),JSON.stringify(after??null)]);
};
const csvCell=(value:unknown)=>{
 const plain=String(value??"").replace(/\r|\n/g," ");
 const safe=/^[=+\-@]/.test(plain)?"'"+plain:plain;
 return '"'+safe.replace(/"/g,'""')+'"';
};

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
