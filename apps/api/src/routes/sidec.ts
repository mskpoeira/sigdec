import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { buildSidecPackage, canonicalJson, hashSidecPackage, sidecPackageSummaryCsv, type SidecPackage } from "../lib/sidec-package.js";
import { buildSidecManifest, filterSidecDiffs, hashSidecManifest, sidecDiffCategories, type SidecManifestDocument } from "../lib/sidec-manifest.js";
import { buildPdf } from "./documents.js";
import { buildMappedFields, diffSidecValues, evaluateCobradeRequirements, evaluateSidecReadiness, isSidecReady, type CobradeRequirement, type SidecMapping } from "../lib/sidec-readiness.js";

const exportCreateSchema=z.object({
 documentIds:z.array(z.string().uuid()).max(50).default([])
});

const mappingSchema=z.object({
 sourcePath:z.string().trim().min(3).max(120),
 targetField:z.string().trim().regex(/^[A-Za-z0-9_.-]+$/).max(160),
 required:z.boolean().default(false),
 enabled:z.boolean().default(true),
 sortOrder:z.number().int().min(0).max(10000).default(100)
});
const mappingsUpdateSchema=z.object({items:z.array(mappingSchema).min(1).max(100)});

const allowedSourcePaths=[
 "incident.protocol","incident.cobradeCode","incident.summary","incident.status","incident.priority",
 "incident.description","incident.addressLine","incident.neighborhood","incident.referencePoint",
 "incident.latitude","incident.longitude","incident.typeCode","incident.typeName","incident.typeGroup",
 "incident.riskToLife","incident.source","incident.createdAt","incident.updatedAt"
] as const;

const cobradeRequirementSchema=z.object({
 sourcePath:z.string().trim().min(3).max(120),
 label:z.string().trim().min(3).max(200),
 required:z.boolean().default(true),
 enabled:z.boolean().default(true),
 sortOrder:z.number().int().min(0).max(10000).default(100)
});
const cobradeRequirementsUpdateSchema=z.object({
 cobradeCode:z.string().trim().min(1).max(30),
 items:z.array(cobradeRequirementSchema).max(100)
});

const returnEnvelopeSchema=z.object({
 schemaVersion:z.literal("sigdec-sidec-return/1.0"),
 externalProtocol:z.string().trim().min(1).max(200),
 outcome:z.enum(["ACKNOWLEDGED","REJECTED"]),
 receivedAt:z.coerce.date(),
 sourceName:z.string().trim().max(200).optional(),
 notes:z.string().trim().max(8000).optional()
});

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

async function effectiveCobradeRequirements(org:string,cobradeCode:string|null|undefined):Promise<CobradeRequirement[]>{
 if(!cobradeCode)return [];
 const r=await db.query(`SELECT source_path AS "sourcePath",label,required,enabled,sort_order AS "sortOrder"
   FROM sidec_cobrade_requirements
   WHERE organization_id=$1 AND cobrade_code=$2
   ORDER BY sort_order,source_path`,[org,cobradeCode]);
 return r.rows as CobradeRequirement[];
}

async function zipBuffer(entries:Array<{name:string;data:Buffer|string}>){
 const archive=archiver("zip",{zlib:{level:9}});
 const stream=new PassThrough();
 const chunks:Buffer[]=[];
 const completed=new Promise<Buffer>((resolve,reject)=>{
  stream.on("data",(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));
  stream.on("end",()=>resolve(Buffer.concat(chunks)));
  stream.on("error",reject);
  archive.on("warning",(error)=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")reject(error)});
  archive.on("error",reject);
 });
 archive.pipe(stream);
 for(const entry of entries)archive.append(entry.data,{name:entry.name});
 await archive.finalize();
 return completed;
}

async function effectiveMappings(org:string):Promise<SidecMapping[]>{
 const r=await db.query(`SELECT DISTINCT ON (target_field)
   source_path AS "sourcePath",target_field AS "targetField",required,enabled,sort_order AS "sortOrder"
   FROM sidec_field_mappings
   WHERE organization_id IS NULL OR organization_id=$1
   ORDER BY target_field,(organization_id IS NOT NULL) DESC`,[org]);
 return r.rows as SidecMapping[];
}

function incidentRoot(incident:Record<string,unknown>){
 return {incident};
}

function organizationId(value:string|null){
 if(!value){const error=new Error("Usuário sem organização vinculada.");(error as Error&{statusCode?:number}).statusCode=409;throw error;}
 return value;
}

export async function sidecRoutes(app:FastifyInstance){
 app.get("/api/v1/sidec/mappings",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  return {items:await effectiveMappings(org),sourceOptions:[...allowedSourcePaths]};
 });

 app.put("/api/v1/sidec/mappings",{preHandler:requirePermission("sidec_mappings.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=mappingsUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const items=parsed.data.items;
  const targets=new Set<string>();
  for(const item of items){
   if(!(allowedSourcePaths as readonly string[]).includes(item.sourcePath))return reply.code(400).send({error:"INVALID_SOURCE_PATH",sourcePath:item.sourcePath});
   if(targets.has(item.targetField))return reply.code(400).send({error:"DUPLICATE_TARGET_FIELD",targetField:item.targetField});
   targets.add(item.targetField);
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const before=await client.query(`SELECT source_path AS "sourcePath",target_field AS "targetField",required,enabled,sort_order AS "sortOrder"
     FROM sidec_field_mappings WHERE organization_id=$1 ORDER BY sort_order,target_field`,[org]);
   await client.query("DELETE FROM sidec_field_mappings WHERE organization_id=$1",[org]);
   for(const item of items){
    await client.query(`INSERT INTO sidec_field_mappings(organization_id,source_path,target_field,required,enabled,sort_order,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[org,item.sourcePath,item.targetField,item.required,item.enabled,item.sortOrder,auth.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,ip,user_agent,before_data,after_data)
     VALUES($1,'sidec_mappings.replace','sidec_field_mappings',$2,$3,$4::jsonb,$5::jsonb)`,[auth.userId,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows),JSON.stringify(items)]);
   await client.query("COMMIT");
   return {items:await effectiveMappings(org)};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
 });

 app.get("/api/v1/sidec/cobrade-requirements",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId);
  const cobradeCode=String((request.query as {cobradeCode?:string})?.cobradeCode??"").trim();
  if(!cobradeCode)return reply.code(400).send({error:"COBRADE_REQUIRED"});
  return {cobradeCode,items:await effectiveCobradeRequirements(org,cobradeCode),sourceOptions:[...allowedSourcePaths]};
 });

 app.put("/api/v1/sidec/cobrade-requirements",{preHandler:requirePermission("sidec_cobrade_requirements.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=cobradeRequirementsUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const {cobradeCode,items}=parsed.data;
  const catalogCount=await db.query(`SELECT count(*)::int AS count FROM cobrade_catalog WHERE organization_id=$1 AND active=true`,[org]);
  if(Number(catalogCount.rows[0]?.count??0)>0){
   const valid=await db.query(`SELECT 1 FROM cobrade_catalog WHERE organization_id=$1 AND code=$2 AND active=true`,[org,cobradeCode]);
   if(!valid.rows[0])return reply.code(400).send({error:"COBRADE_NOT_IN_CATALOG"});
  }
  const paths=new Set<string>();
  for(const item of items){
   if(!(allowedSourcePaths as readonly string[]).includes(item.sourcePath))return reply.code(400).send({error:"INVALID_SOURCE_PATH",sourcePath:item.sourcePath});
   if(paths.has(item.sourcePath))return reply.code(400).send({error:"DUPLICATE_SOURCE_PATH",sourcePath:item.sourcePath});
   paths.add(item.sourcePath);
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const before=await client.query(`SELECT source_path AS "sourcePath",label,required,enabled,sort_order AS "sortOrder"
     FROM sidec_cobrade_requirements WHERE organization_id=$1 AND cobrade_code=$2 ORDER BY sort_order,source_path`,[org,cobradeCode]);
   await client.query(`DELETE FROM sidec_cobrade_requirements WHERE organization_id=$1 AND cobrade_code=$2`,[org,cobradeCode]);
   for(const item of items){
    await client.query(`INSERT INTO sidec_cobrade_requirements(organization_id,cobrade_code,source_path,label,required,enabled,sort_order,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[org,cobradeCode,item.sourcePath,item.label,item.required,item.enabled,item.sortOrder,auth.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,ip,user_agent,before_data,after_data,metadata)
     VALUES($1,'sidec_cobrade_requirements.replace','sidec_cobrade_requirements',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
     [auth.userId,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows),JSON.stringify(items),JSON.stringify({cobradeCode})]);
   await client.query("COMMIT");
   return {cobradeCode,items:await effectiveCobradeRequirements(org,cobradeCode)};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
 });

 app.get("/api/v1/incidents/:id/sidec-readiness",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const incident=await db.query(`SELECT i.id,i.protocol,i.status,i.priority,i.risk_to_life AS "riskToLife",i.summary,i.description,i.source,
    i.address_line AS "addressLine",i.neighborhood,i.reference_point AS "referencePoint",i.latitude,i.longitude,
    i.created_at AS "createdAt",i.updated_at AS "updatedAt",t.code AS "typeCode",t.name AS "typeName",
    t.group_name AS "typeGroup",t.cobrade_code AS "cobradeCode"
    FROM incidents i JOIN incident_types t ON t.id=i.incident_type_id
    WHERE i.id=$1 AND i.organization_id=$2`,[id,org]);
  const row=incident.rows[0] as Record<string,unknown>|undefined;
  if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  const mappings=await effectiveMappings(org);
  const root=incidentRoot(row);
  const cobradeCode=String(row.cobradeCode??"").trim()||null;
  const cobradeRequirements=await effectiveCobradeRequirements(org,cobradeCode);
  const checks=[...evaluateSidecReadiness(root,mappings),...evaluateCobradeRequirements(root,cobradeRequirements)];
  const documents=await db.query(`SELECT id,number,title,document_type AS "documentType",revision,content_hash AS "contentHash",issued_at AS "issuedAt"
    FROM technical_documents
    WHERE organization_id=$1 AND incident_id=$2 AND status='ISSUED'
    ORDER BY issued_at DESC,created_at DESC`,[org,id]);
  return {ready:isSidecReady(checks),checks,mappings,cobradeCode,cobradeRequirements,availableDocuments:documents.rows,mappedFields:buildMappedFields(root,mappings)};
 });

 app.get("/api/v1/sidec-exports",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const r=await db.query(`SELECT e.id,e.incident_id AS "incidentId",i.protocol,i.summary,e.revision,e.schema_version AS "schemaVersion",e.status,
    e.snapshot_hash AS "snapshotHash",e.manifest_hash AS "manifestHash",e.external_protocol AS "externalProtocol",e.external_notes AS "externalNotes",
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
  const r=await db.query(`SELECT e.id,e.revision,e.schema_version AS "schemaVersion",e.status,e.snapshot_hash AS "snapshotHash",e.manifest_hash AS "manifestHash",
    e.external_protocol AS "externalProtocol",e.external_notes AS "externalNotes",e.exported_at AS "exportedAt",
    e.submitted_at AS "submittedAt",e.acknowledged_at AS "acknowledgedAt",e.rejected_at AS "rejectedAt",
    e.created_at AS "createdAt",e.updated_at AS "updatedAt",
    COALESCE((SELECT json_agg(json_build_object(
      'id',d.document_id,'number',d.document_number,'title',d.document_title,'documentType',d.document_type,
      'revision',d.document_revision,'contentHash',d.content_hash
    ) ORDER BY d.document_title) FROM sidec_export_documents d WHERE d.export_id=e.id),'[]'::json) AS documents
    FROM sidec_exports e WHERE e.incident_id=$1 AND e.organization_id=$2 ORDER BY e.revision DESC`,[id,org]);
  return {items:r.rows};
 });

 app.post("/api/v1/incidents/:id/sidec-exports",{preHandler:requirePermission("sidec_exports.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=exportCreateSchema.safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const documentIds=[...new Set(parsed.data.documentIds)];
  const [organization,incident]=await Promise.all([
   db.query(`SELECT name,document_number AS "documentNumber" FROM organizations WHERE id=$1`,[org]),
   db.query(`SELECT i.id,i.protocol,i.status,i.priority,i.risk_to_life AS "riskToLife",i.summary,i.description,i.source,
      i.address_line AS "addressLine",i.neighborhood,i.reference_point AS "referencePoint",i.latitude,i.longitude,
      i.created_at AS "createdAt",i.updated_at AS "updatedAt",t.code AS "typeCode",t.name AS "typeName",
      t.group_name AS "typeGroup",t.cobrade_code AS "cobradeCode"
      FROM incidents i JOIN incident_types t ON t.id=i.incident_type_id
      WHERE i.id=$1 AND i.organization_id=$2`,[id,org])
  ]);
  const incidentRow=incident.rows[0] as Record<string,unknown>|undefined;
  if(!incidentRow)return reply.code(404).send({error:"NOT_FOUND"});

  const mappings=await effectiveMappings(org);
  const root=incidentRoot(incidentRow);
  const cobradeCode=String(incidentRow.cobradeCode??"").trim()||null;
  const cobradeRequirements=await effectiveCobradeRequirements(org,cobradeCode);
  const checks=[...evaluateSidecReadiness(root,mappings),...evaluateCobradeRequirements(root,cobradeRequirements)];
  if(!isSidecReady(checks))return reply.code(409).send({error:"NOT_READY",checks,cobradeCode,cobradeRequirements});

  const selectedDocuments=documentIds.length
   ? await db.query(`SELECT id,number,title,document_type AS "documentType",revision,content_hash AS "contentHash",issued_at AS "issuedAt"
       FROM technical_documents
       WHERE organization_id=$1 AND incident_id=$2 AND status='ISSUED' AND id=ANY($3::uuid[])
       ORDER BY issued_at ASC,created_at ASC`,[org,id,documentIds])
   : {rows:[] as Record<string,unknown>[]};
  if(selectedDocuments.rows.length!==documentIds.length)return reply.code(400).send({error:"INVALID_DOCUMENT_SELECTION"});

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
   db.query(`SELECT d.delivered_at AS "deliveredAt",
      COALESCE(json_agg(json_build_object('item',hi.name,'quantity',di.quantity,'unit',hi.unit)) FILTER (WHERE hi.id IS NOT NULL),'[]'::json) AS items
      FROM humanitarian_deliveries d
      LEFT JOIN humanitarian_delivery_items di ON di.delivery_id=d.id
      LEFT JOIN humanitarian_items hi ON hi.id=di.item_id
      WHERE d.incident_id=$1 AND d.organization_id=$2
      GROUP BY d.id ORDER BY d.delivered_at ASC`,[id,org]),
   db.query(`SELECT occurred_at AS "occurredAt",event_type AS "eventType"
      FROM incident_timeline WHERE incident_id=$1 ORDER BY occurred_at ASC,id ASC`,[id])
  ]);

  const pkg=buildSidecPackage({
   municipality:{name:String(organization.rows[0]?.name??"Ubatuba"),state:"SP"},
   incident:incidentRow,
   actions:actions.rows,
   inspections:inspections.rows,
   supportRequests:supportRequests.rows,
   humanitarianDeliveries:deliveries.rows,
   timeline:timeline.rows,
   documents:selectedDocuments.rows,
   mappedFields:buildMappedFields(root,mappings)
  });
  const snapshotHash=hashSidecPackage(pkg);
  const readinessSnapshot={ready:true,checks,mappings,cobradeCode,cobradeRequirements};
  const manifestDocuments=(selectedDocuments.rows as Array<Record<string,any>>).map(document=>({
   id:String(document.id),
   number:document.number??null,
   title:String(document.title),
   documentType:String(document.documentType),
   revision:Number(document.revision),
   contentHash:document.contentHash??null
  })) satisfies SidecManifestDocument[];

  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT id FROM incidents WHERE id=$1 AND organization_id=$2 FOR UPDATE",[id,org]);
   const revisionResult=await client.query<{revision:number}>(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM sidec_exports WHERE incident_id=$1`,[id]);
   const revision=Number(revisionResult.rows[0]?.revision??1);
   const manifest=buildSidecManifest({packageSchemaVersion:"1.1",revision,snapshotHash,documents:manifestDocuments});
   const manifestHash=hashSidecManifest(manifest);
   const created=await client.query<{id:string}>(`INSERT INTO sidec_exports(
      organization_id,incident_id,revision,schema_version,status,snapshot,snapshot_hash,manifest_hash,readiness_snapshot,created_by
    ) VALUES($1,$2,$3,'1.1','READY',$4::jsonb,$5,$6,$7::jsonb,$8) RETURNING id`,
    [org,id,revision,JSON.stringify(pkg),snapshotHash,manifestHash,JSON.stringify(readinessSnapshot),auth.userId]);
   const exportId=created.rows[0]?.id;
   if(!exportId)throw new Error("Falha ao criar pacote SIDEC.");
   for(const document of selectedDocuments.rows as Array<Record<string,any>>){
    await client.query(`INSERT INTO sidec_export_documents(
      export_id,document_id,document_number,document_title,document_type,document_revision,content_hash
    ) VALUES($1,$2,$3,$4,$5,$6,$7)`,[exportId,document.id,document.number??null,document.title,document.documentType,document.revision,document.contentHash??null]);
   }
   await client.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
      VALUES($1,'sidec_export.created',$2,$3,$4::jsonb)`,[id,auth.userId,`Pacote SIDEC revisão ${revision} gerado.`,JSON.stringify({exportId,revision,snapshotHash,manifestHash,documents:documentIds.length})]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
      VALUES($1,'sidec_export.create','sidec_export',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,exportId,request.ip,request.headers["user-agent"]??null,JSON.stringify({incidentId:id,revision,status:"READY",snapshotHash,manifestHash}),JSON.stringify({schemaVersion:"1.1",documents:documentIds.length,cobradeCode})]);
   await client.query("COMMIT");
   return reply.code(201).send({id:exportId,revision,status:"READY",schemaVersion:"1.1",snapshotHash,manifestHash,readiness:readinessSnapshot,documents:selectedDocuments.rows});
  }catch(error){
   await client.query("ROLLBACK");throw error;
  }finally{client.release();}
 });

 app.get("/api/v1/sidec-exports/:id/compare",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const query=request.query as {against?:string;category?:string};
  const against=String(query?.against??"").trim();
  const category=String(query?.category??"all").trim();
  const currentResult=await db.query(`SELECT id,incident_id AS "incidentId",revision,snapshot FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[id,org]);
  const current=currentResult.rows[0] as {id:string;incidentId:string;revision:number;snapshot:SidecPackage}|undefined;
  if(!current)return reply.code(404).send({error:"NOT_FOUND"});
  const previousResult=against
    ? await db.query(`SELECT id,incident_id AS "incidentId",revision,snapshot FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[against,org])
    : await db.query(`SELECT id,incident_id AS "incidentId",revision,snapshot FROM sidec_exports
        WHERE incident_id=$1 AND organization_id=$2 AND revision<$3 ORDER BY revision DESC LIMIT 1`,[current.incidentId,org,current.revision]);
  const previous=previousResult.rows[0] as {id:string;incidentId:string;revision:number;snapshot:SidecPackage}|undefined;
  if(!previous)return {current:{id:current.id,revision:current.revision},against:null,differences:[]};
  if(previous.incidentId!==current.incidentId)return reply.code(409).send({error:"DIFFERENT_INCIDENTS"});
  const differences=diffSidecValues(previous.snapshot,current.snapshot);
  const filtered=filterSidecDiffs(differences,category);
  return {current:{id:current.id,revision:current.revision},against:{id:previous.id,revision:previous.revision},category,categories:["all",...sidecDiffCategories],count:filtered.length,totalCount:differences.length,differences:filtered.slice(0,500)};
 });

 app.get("/api/v1/sidec-exports/:id/download",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const format=String((request.query as {format?:string})?.format??"json").toLowerCase();
  const r=await db.query(`SELECT e.revision,e.schema_version AS "schemaVersion",e.snapshot,e.snapshot_hash AS "snapshotHash",
      e.manifest_hash AS "manifestHash",i.protocol
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
  const item=r.rows[0] as {revision:number;schemaVersion:string;snapshot:SidecPackage;snapshotHash:string;manifestHash?:string|null;protocol:string}|undefined;
  if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  const safeProtocol=item.protocol.replace(/[^A-Za-z0-9_-]/g,"_");

  if(format==="csv"){
   reply.header("Content-Type","text/csv; charset=utf-8");
   reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.csv"`);
   return "\uFEFF"+sidecPackageSummaryCsv(item.snapshot);
  }

  if(format==="zip"){
   const docs=await db.query(`SELECT d.document_id AS id,d.document_number AS number,d.document_title AS title,
      d.document_type AS "documentType",d.document_revision AS revision,d.content_hash AS "contentHash"
      FROM sidec_export_documents d WHERE d.export_id=$1 ORDER BY d.document_title,d.document_id`,[id]);
   const manifest=buildSidecManifest({
    packageSchemaVersion:item.schemaVersion,
    revision:item.revision,
    snapshotHash:item.snapshotHash,
    documents:docs.rows as SidecManifestDocument[]
   });
   const computedManifestHash=hashSidecManifest(manifest);
   if(item.manifestHash&&item.manifestHash!==computedManifestHash){
    return reply.code(409).send({error:"MANIFEST_INTEGRITY_ERROR",expected:item.manifestHash,computed:computedManifestHash});
   }

   const entries:Array<{name:string;data:Buffer|string}>=[
    {name:"pacote.json",data:JSON.stringify({snapshotHash:item.snapshotHash,manifestHash:computedManifestHash,...item.snapshot},null,2)},
    {name:"resumo.csv",data:"\uFEFF"+sidecPackageSummaryCsv(item.snapshot)},
    {name:"manifesto.json",data:JSON.stringify({manifestHash:computedManifestHash,...manifest},null,2)}
   ];

   for(const documentRef of docs.rows as SidecManifestDocument[]){
    const documentResult=await db.query<Record<string,any>>(`SELECT d.id,d.document_type AS "documentType",d.number,d.title,
      d.subject,d.status,d.revision,d.content->>'text' AS "contentText",d.legal_basis AS "legalBasis",d.recipient,
      d.valid_until AS "validUntil",d.content_hash AS "contentHash",o.name AS "organizationName",i.protocol
      FROM technical_documents d
      JOIN organizations o ON o.id=d.organization_id
      LEFT JOIN incidents i ON i.id=d.incident_id
      WHERE d.id=$1 AND d.organization_id=$2 AND d.status='ISSUED'`,[documentRef.id,org]);
    const document=documentResult.rows[0];
    if(!document)return reply.code(409).send({error:"DOCUMENT_NOT_AVAILABLE",documentId:documentRef.id});
    if(documentRef.contentHash&&document.contentHash!==documentRef.contentHash){
     return reply.code(409).send({error:"DOCUMENT_INTEGRITY_ERROR",documentId:documentRef.id});
    }
    const signatures=await db.query<Record<string,any>>(`SELECT s.signature_type AS "signatureType",s.signed_at AS "signedAt",
      u.display_name AS "displayName",u.matricula
      FROM technical_document_signatures s JOIN users u ON u.id=s.signed_by
      WHERE s.document_id=$1 ORDER BY s.signed_at`,[documentRef.id]);
    const pdf=await buildPdf(document,signatures.rows);
    const safeDocument=String(documentRef.number??documentRef.id).replace(/[^0-9A-Za-z_-]/g,"_");
    entries.push({name:`documentos/${safeDocument}.pdf`,data:pdf});
   }

   const zip=await zipBuffer(entries);
   return reply.type("application/zip")
    .header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.zip"`)
    .header("Content-Length",String(zip.length))
    .send(zip);
  }

  if(format!=="json")return reply.code(400).send({error:"UNSUPPORTED_FORMAT"});
  reply.header("Content-Type","application/json; charset=utf-8");
  reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.json"`);
  return JSON.stringify({snapshotHash:item.snapshotHash,manifestHash:item.manifestHash??null,...item.snapshot},null,2);
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
