import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { buildSidecPackage, hashSidecPackage, sidecPackageSummaryCsv, type SidecPackage } from "../lib/sidec-package.js";

const statusSchema=z.object({
 status:z.enum(["EXPORTED","SUBMITTED","ACKNOWLEDGED","REJECTED","CANCELLED"]),
 externalProtocol:z.string().trim().max(200).optional(),
 externalNotes:z.string().trim().max(8000).optional()
});

const transitions:Record<string,string[]>={
 READY:["EXPORTED","CANCELLED"],
 EXPORTED:["SUBMITTED","CANCELLED"],
 SUBMITTED:["ACKNOWLEDGED","REJECTED"],
 ACKNOWLEDGED:[],
 REJECTED:[],
 CANCELLED:[]
};

function organizationId(value:string|null){
 if(!value){const error=new Error("Usuário sem organização vinculada.");(error as Error&{statusCode?:number}).statusCode=409;throw error;}
 return value;
}

export async function sidecRoutes(app:FastifyInstance){
 app.get("/api/v1/sidec-exports",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const r=await db.query(`SELECT e.id,e.incident_id AS "incidentId",i.protocol,i.summary,e.revision,e.schema_version AS "schemaVersion",e.status,
    e.snapshot_hash AS "snapshotHash",e.external_protocol AS "externalProtocol",e.external_notes AS "externalNotes",
    e.exported_at AS "exportedAt",e.submitted_at AS "submittedAt",e.acknowledged_at AS "acknowledgedAt",
    e.rejected_at AS "rejectedAt",e.created_at AS "createdAt",e.updated_at AS "updatedAt"
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    WHERE e.organization_id=$1 ORDER BY
      CASE e.status WHEN 'SUBMITTED' THEN 1 WHEN 'READY' THEN 2 WHEN 'EXPORTED' THEN 3 WHEN 'REJECTED' THEN 4 ELSE 5 END,
      e.updated_at DESC LIMIT 300`,[org]);
  return {items:r.rows};
 });
 app.get("/api/v1/incidents/:id/sidec-exports",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const incident=await db.query("SELECT 1 FROM incidents WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!incident.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT id,revision,schema_version AS "schemaVersion",status,snapshot_hash AS "snapshotHash",
    external_protocol AS "externalProtocol",external_notes AS "externalNotes",exported_at AS "exportedAt",
    submitted_at AS "submittedAt",acknowledged_at AS "acknowledgedAt",rejected_at AS "rejectedAt",
    created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sidec_exports WHERE incident_id=$1 AND organization_id=$2 ORDER BY revision DESC`,[id,org]);
  return {items:r.rows};
 });

 app.post("/api/v1/incidents/:id/sidec-exports",{preHandler:requirePermission("sidec_exports.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const [organization,incident]=await Promise.all([
   db.query(`SELECT name,document_number AS "documentNumber" FROM organizations WHERE id=$1`,[org]),
   db.query(`SELECT i.id,i.protocol,i.status,i.priority,i.risk_to_life AS "riskToLife",i.summary,i.description,i.source,
      i.address_line AS "addressLine",i.neighborhood,i.reference_point AS "referencePoint",i.latitude,i.longitude,
      i.created_at AS "createdAt",i.updated_at AS "updatedAt",t.code AS "typeCode",t.name AS "typeName",
      t.group_name AS "typeGroup",t.cobrade_code AS "cobradeCode"
      FROM incidents i JOIN incident_types t ON t.id=i.incident_type_id
      WHERE i.id=$1 AND i.organization_id=$2`,[id,org])
  ]);
  if(!incident.rows[0])return reply.code(404).send({error:"NOT_FOUND"});

  const [actions,inspections,supportRequests,deliveries,timeline]=await Promise.all([
   db.query(`SELECT action_type AS "actionType",title,description,started_at AS "startedAt",ended_at AS "endedAt",
      address_line AS "addressLine",neighborhood,latitude,longitude,participants_count AS "participantsCount"
      FROM civil_defense_actions WHERE incident_id=$1 AND organization_id=$2 ORDER BY started_at ASC`,[id,org]),
   db.query(`SELECT inspection_type AS "inspectionType",status,risk_level AS "riskLevel",address_line AS "addressLine",
      latitude,longitude,scheduled_at AS "scheduledAt",completed_at AS "completedAt",findings,recommendations
      FROM inspections WHERE incident_id=$1 AND organization_id=$2 ORDER BY created_at ASC`,[id,org]),
   db.query(`SELECT request_type AS "requestType",status,destination,justification,requested_items AS "requestedItems",
      external_protocol AS "externalProtocol",submitted_at AS "submittedAt",resolved_at AS "resolvedAt",resolution_notes AS "resolutionNotes"
      FROM operational_support_requests WHERE incident_id=$1 AND organization_id=$2 ORDER BY created_at ASC`,[id,org]),
   db.query(`SELECT d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",d.notes,
      COALESCE(json_agg(json_build_object('item',hi.name,'quantity',di.quantity,'unit',hi.unit)) FILTER (WHERE hi.id IS NOT NULL),'[]'::json) AS items
      FROM humanitarian_deliveries d
      LEFT JOIN humanitarian_delivery_items di ON di.delivery_id=d.id
      LEFT JOIN humanitarian_items hi ON hi.id=di.item_id
      WHERE d.incident_id=$1 AND d.organization_id=$2
      GROUP BY d.id ORDER BY d.delivered_at ASC`,[id,org]),
   db.query(`SELECT occurred_at AS "occurredAt",event_type AS "eventType",note,metadata
      FROM incident_timeline WHERE incident_id=$1 ORDER BY occurred_at ASC,id ASC`,[id])
  ]);

  const pkg=buildSidecPackage({
   municipality:{name:String(organization.rows[0]?.name??"Ubatuba"),state:"SP"},
   incident:incident.rows[0],
   actions:actions.rows,
   inspections:inspections.rows,
   supportRequests:supportRequests.rows,
   humanitarianDeliveries:deliveries.rows,
   timeline:timeline.rows
  });
  const snapshotHash=hashSidecPackage(pkg);

  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT id FROM incidents WHERE id=$1 AND organization_id=$2 FOR UPDATE",[id,org]);
   const revisionResult=await client.query<{revision:number}>(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM sidec_exports WHERE incident_id=$1`,[id]);
   const revision=Number(revisionResult.rows[0]?.revision??1);
   const created=await client.query<{id:string}>(`INSERT INTO sidec_exports(
      organization_id,incident_id,revision,schema_version,status,snapshot,snapshot_hash,created_by
    ) VALUES($1,$2,$3,'1.0','READY',$4::jsonb,$5,$6) RETURNING id`,[org,id,revision,JSON.stringify(pkg),snapshotHash,auth.userId]);
   const exportId=created.rows[0]?.id;
   if(!exportId)throw new Error("Falha ao criar pacote SIDEC.");
   await client.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
      VALUES($1,'sidec_export.created',$2,$3,$4::jsonb)`,[id,auth.userId,`Pacote SIDEC revisão ${revision} gerado.`,JSON.stringify({exportId,revision,snapshotHash})]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
      VALUES($1,'sidec_export.create','sidec_export',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,exportId,request.ip,request.headers["user-agent"]??null,JSON.stringify({incidentId:id,revision,status:"READY",snapshotHash}),JSON.stringify({schemaVersion:"1.0"})]);
   await client.query("COMMIT");
   return reply.code(201).send({id:exportId,revision,status:"READY",snapshotHash});
  }catch(error){
   await client.query("ROLLBACK");throw error;
  }finally{client.release();}
 });

 app.get("/api/v1/sidec-exports/:id/download",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const format=String((request.query as {format?:string})?.format??"json").toLowerCase();
  const r=await db.query(`SELECT e.revision,e.snapshot,e.snapshot_hash AS "snapshotHash",i.protocol
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
  const item=r.rows[0] as {revision:number;snapshot:SidecPackage;snapshotHash:string;protocol:string}|undefined;
  if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  const safeProtocol=item.protocol.replace(/[^A-Za-z0-9_-]/g,"_");
  if(format==="csv"){
   reply.header("Content-Type","text/csv; charset=utf-8");
   reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.csv"`);
   return "\uFEFF"+sidecPackageSummaryCsv(item.snapshot);
  }
  if(format!=="json")return reply.code(400).send({error:"UNSUPPORTED_FORMAT"});
  reply.header("Content-Type","application/json; charset=utf-8");
  reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.json"`);
  return JSON.stringify({snapshotHash:item.snapshotHash,...item.snapshot},null,2);
 });

 app.patch("/api/v1/sidec-exports/:id/status",{preHandler:requirePermission("sidec_exports.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=statusSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const before=await db.query(`SELECT id,incident_id AS "incidentId",revision,status,external_protocol AS "externalProtocol" FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[id,org]);
  const current=before.rows[0] as {incidentId:string;revision:number;status:string;externalProtocol?:string|null}|undefined;
  if(!current)return reply.code(404).send({error:"NOT_FOUND"});
  const next=parsed.data.status;
  if(!(transitions[current.status]??[]).includes(next))return reply.code(409).send({error:"INVALID_TRANSITION",from:current.status,to:next});
  if(next==="SUBMITTED"&&!parsed.data.externalProtocol&&!current.externalProtocol)return reply.code(400).send({error:"EXTERNAL_PROTOCOL_REQUIRED"});
  const r=await db.query(`UPDATE sidec_exports SET status=$1,
    external_protocol=COALESCE($2,external_protocol),external_notes=COALESCE($3,external_notes),
    exported_at=CASE WHEN $1='EXPORTED' THEN COALESCE(exported_at,now()) ELSE exported_at END,
    submitted_at=CASE WHEN $1='SUBMITTED' THEN COALESCE(submitted_at,now()) ELSE submitted_at END,
    acknowledged_at=CASE WHEN $1='ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
    rejected_at=CASE WHEN $1='REJECTED' THEN now() ELSE rejected_at END,
    updated_at=now()
    WHERE id=$4 AND organization_id=$5
    RETURNING id,status,external_protocol AS "externalProtocol",external_notes AS "externalNotes",updated_at AS "updatedAt"`,
    [next,parsed.data.externalProtocol??null,parsed.data.externalNotes??null,id,org]);
  await db.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
    VALUES($1,'sidec_export.status_changed',$2,$3,$4::jsonb)`,[current.incidentId,auth.userId,`Pacote SIDEC revisão ${current.revision}: ${current.status} → ${next}.`,JSON.stringify({exportId:id,externalProtocol:parsed.data.externalProtocol??current.externalProtocol??null})]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_export.status','sidec_export',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });
}
