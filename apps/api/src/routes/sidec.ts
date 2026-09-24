import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { buildSidecPackage, hashSidecPackage, sidecPackageSummaryCsv, type SidecPackage } from "../lib/sidec-package.js";
import { buildSidecManifest, filterSidecDiffs, hashSidecManifest, sidecDiffCategories, type SidecManifestDocument } from "../lib/sidec-manifest.js";
import { currentSidecSigningKeyId, hashBinary, signSidecManifestHashVersioned, verifySidecManifestSignature } from "../lib/sidec-signature.js";
import { isSidecDeadlineOverdue, sidecDueAt, type SidecDeadlinePolicy } from "../lib/sidec-deadlines.js";
import { buildSidecCustodyPdf, type CustodyEvent } from "../lib/sidec-custody.js";
import { signSidecIntegrity, signSidecTimestamp, verifySidecIntegrity, verifySidecTimestamp } from "../lib/sidec-asymmetric.js";
import { archiveSidecArtifact, enableSidecArchiveLegalHold, extendSidecArchiveRetention, verifySidecArchive, wormMode } from "../lib/sidec-worm.js";
import { buildPdf } from "./documents.js";
import { buildMappedFields, chooseRequiredDocumentIds, diffSidecValues, evaluateCobradeRequirements, evaluateDocumentRequirements, evaluateSidecReadiness, isSidecReady, mergeDocumentRequirements, type CobradeRequirement, type SidecAvailableDocument, type SidecDocumentRequirement, type SidecMapping } from "../lib/sidec-readiness.js";

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

const documentRequirementSchema=z.object({
 documentType:z.enum(["REPORT","OPINION","INTERDICTION","DECLARATION","FORM","OTHER"]),
 label:z.string().trim().min(3).max(200),
 minCount:z.number().int().min(1).max(20).default(1),
 required:z.boolean().default(true),
 enabled:z.boolean().default(true)
});
const documentRequirementsUpdateSchema=z.object({
 scopeType:z.enum(["DEFAULT","COBRADE","INCIDENT_TYPE"]),
 scopeValue:z.string().trim().min(1).max(80).default("*"),
 items:z.array(documentRequirementSchema).max(20)
});

const deadlinePolicyItemSchema=z.object({
 pendingStatus:z.enum(["PACKAGE_READY","AWAITING_PROTOCOL","AWAITING_RETURN","REJECTED"]),
 warningAfterHours:z.number().int().min(1).max(8760),
 severity:z.enum(["WATCH","WARNING","EMERGENCY"]),
 enabled:z.boolean().default(true)
});
const deadlinePoliciesUpdateSchema=z.object({items:z.array(deadlinePolicyItemSchema).min(1).max(4)});

const retentionSchema=z.object({
 retentionClass:z.enum(["UNSPECIFIED","OPERATIONAL","ARCHIVAL","LEGAL_HOLD"]),
 retainUntil:z.coerce.date().nullable().optional(),
 legalHold:z.boolean().default(false),
 notes:z.string().trim().max(4000).nullable().optional()
});

const archiveRetentionExtensionSchema=z.object({
 retainUntil:z.coerce.date(),
 reason:z.string().trim().min(5).max(4000)
});
const archiveLegalHoldEnableSchema=z.object({
 reason:z.string().trim().min(5).max(4000)
});


const returnEnvelopeSchema=z.object({
 schemaVersion:z.literal("sigdec-sidec-return/1.0"),
 externalProtocol:z.string().trim().min(1).max(200),
 outcome:z.enum(["ACKNOWLEDGED","REJECTED"]),
 receivedAt:z.coerce.date(),
 sourceName:z.string().trim().max(200).optional(),
 notes:z.string().trim().max(8000).optional()
});

const integrityProofBase={
 export:z.object({
  id:z.string().uuid(),
  protocol:z.string().min(1).max(200),
  revision:z.number().int().positive(),
  schemaVersion:z.string().min(1).max(40),
  sealedAt:z.string().min(1)
 }),
 artifact:z.object({
  fileName:z.string().min(1).max(300),
  byteSize:z.number().int().nonnegative(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/)
 }),
 manifest:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
 hmac:z.object({
  algorithm:z.literal("HMAC-SHA256"),
  keyId:z.string().min(1).max(80),
  signature:z.string().regex(/^[a-f0-9]{64}$/)
 }),
 ed25519:z.object({
  algorithm:z.literal("Ed25519"),
  keyId:z.string().min(1).max(80),
  signature:z.string().min(40).max(300),
  publicKey:z.string().min(40).max(4000),
  publicKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  attestedAt:z.string().min(1)
 })
};

const integrityProofSchema=z.union([
 z.object({
  proofVersion:z.literal("sigdec-sidec-integrity-proof/1.0"),
  ...integrityProofBase
 }),
 z.object({
  proofVersion:z.literal("sigdec-sidec-integrity-proof/1.1"),
  ...integrityProofBase,
  publicVerificationUrl:z.string().url().max(2000),
  timestamp:z.object({
   algorithm:z.literal("Ed25519"),
   keyId:z.string().min(1).max(80),
   statementHash:z.string().regex(/^[a-f0-9]{64}$/),
   timestampedAt:z.string().min(1),
   signature:z.string().min(40).max(300),
   publicKey:z.string().min(40).max(4000),
   publicKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/)
  })
 })
]);

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

async function effectiveDeadlinePolicies(org:string):Promise<SidecDeadlinePolicy[]>{
 const r=await db.query(`SELECT DISTINCT ON (pending_status)
   pending_status AS "pendingStatus",warning_after_hours AS "warningAfterHours",severity,enabled
   FROM sidec_deadline_policies
   WHERE organization_id IS NULL OR organization_id=$1
   ORDER BY pending_status,(organization_id IS NOT NULL) DESC`,[org]);
 return r.rows as SidecDeadlinePolicy[];
}

export async function evaluateSidecDeadlineAlerts(organizationId?:string){
 const organizations=organizationId?[organizationId]:(await db.query(`SELECT DISTINCT organization_id AS id FROM sidec_exports`)).rows.map((row:any)=>String(row.id));
 let created=0;
 for(const org of organizations){
  const policies=await effectiveDeadlinePolicies(org);
  const exports=await db.query(`SELECT latest.*
    FROM (
      SELECT DISTINCT ON (e.incident_id)
        e.id AS "exportId",e.incident_id AS "incidentId",e.status,
        e.created_at AS "createdAt",e.updated_at AS "updatedAt",e.exported_at AS "exportedAt",
        e.submitted_at AS "submittedAt",e.rejected_at AS "rejectedAt"
      FROM sidec_exports e
      WHERE e.organization_id=$1
      ORDER BY e.incident_id,e.revision DESC
    ) latest
    WHERE latest.status IN ('READY','EXPORTED','SUBMITTED','REJECTED')`,[org]);
  for(const row of exports.rows as Array<any>){
   const deadline=sidecDueAt(row,policies);
   if(!deadline||!isSidecDeadlineOverdue(deadline.dueAt))continue;
   const inserted=await db.query(`INSERT INTO sidec_deadline_alerts(
      organization_id,incident_id,export_id,pending_status,severity,due_at
    ) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(organization_id,export_id,pending_status,due_at) DO NOTHING
    RETURNING id`,[org,row.incidentId,row.exportId,deadline.pendingStatus,deadline.severity,deadline.dueAt]);
   if(inserted.rows[0])created++;
  }
 }
 return {created};
}

async function effectiveDocumentRequirements(org:string,cobradeCode:string|null|undefined,typeCode:string|null|undefined):Promise<SidecDocumentRequirement[]>{
 const r=await db.query(`SELECT scope_type AS "scopeType",scope_value AS "scopeValue",document_type AS "documentType",
   label,min_count AS "minCount",required,enabled
   FROM sidec_document_requirements
   WHERE organization_id=$1 AND enabled=true AND (
     (scope_type='DEFAULT' AND scope_value='*')
     OR (scope_type='COBRADE' AND $2::text IS NOT NULL AND scope_value=$2)
     OR (scope_type='INCIDENT_TYPE' AND $3::text IS NOT NULL AND scope_value=$3)
   )
   ORDER BY CASE scope_type WHEN 'DEFAULT' THEN 1 WHEN 'INCIDENT_TYPE' THEN 2 ELSE 3 END,document_type`,[org,cobradeCode??null,typeCode??null]);
 return r.rows as SidecDocumentRequirement[];
}

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

type SidecZipSource={
 revision:number;
 schemaVersion:string;
 snapshot:SidecPackage;
 snapshotHash:string;
 manifestHash?:string|null;
 protocol:string;
 status?:string;
};

async function buildSidecZip(org:string,id:string,item:SidecZipSource,options?:{signManifest?:boolean}){
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
 const signedManifest=options?.signManifest?signSidecManifestHashVersioned(computedManifestHash):null;
 const manifestSignature=signedManifest?.signature??null;
 const signingKeyId=signedManifest?.keyId??null;
 if(item.manifestHash&&item.manifestHash!==computedManifestHash){
  throw Object.assign(new Error("Hash do manifesto divergente."),{statusCode:409,code:"MANIFEST_INTEGRITY_ERROR",expected:item.manifestHash,computed:computedManifestHash});
 }

 const entries:Array<{name:string;data:Buffer|string}>=[
  {name:"pacote.json",data:JSON.stringify({snapshotHash:item.snapshotHash,manifestHash:computedManifestHash,...item.snapshot},null,2)},
  {name:"resumo.csv",data:"\uFEFF"+sidecPackageSummaryCsv(item.snapshot)},
  {name:"manifesto.json",data:JSON.stringify({
   manifestHash:computedManifestHash,
   signature:manifestSignature?{algorithm:"HMAC-SHA256",keyId:signingKeyId,value:manifestSignature,scope:"assinatura interna SIGDEC; não ICP-Brasil"}:null,
   ...manifest
  },null,2)}
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
  if(!document)throw Object.assign(new Error("Documento emitido indisponível."),{statusCode:409,code:"DOCUMENT_NOT_AVAILABLE",documentId:documentRef.id});
  if(documentRef.contentHash&&document.contentHash!==documentRef.contentHash){
   throw Object.assign(new Error("Hash documental divergente."),{statusCode:409,code:"DOCUMENT_INTEGRITY_ERROR",documentId:documentRef.id});
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
 const safeProtocol=item.protocol.replace(/[^A-Za-z0-9_-]/g,"_");
 return {zip,manifest,manifestHash:computedManifestHash,manifestSignature,signingKeyId,fileName:`SIDEC-${safeProtocol}-R${item.revision}.zip`};
}

async function ensureSidecArtifactAttestation(org:string,id:string,userId:string){
 const current=await db.query(`SELECT t.export_id AS "exportId",t.algorithm,t.key_id AS "keyId",t.signature,
   t.public_key AS "publicKey",t.public_key_fingerprint AS "publicKeyFingerprint",t.attested_at AS "attestedAt"
   FROM sidec_artifact_attestations t WHERE t.export_id=$1 AND t.organization_id=$2`,[id,org]);
 if(current.rows[0])return current.rows[0];

 const artifact=await db.query(`SELECT export_id AS "exportId",content_hash AS "artifactHash",manifest_hash AS "manifestHash"
   FROM sidec_export_artifacts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 const row=artifact.rows[0] as {exportId:string;artifactHash:string;manifestHash:string}|undefined;
 if(!row)throw Object.assign(new Error("Artefato SIDEC selado não encontrado."),{statusCode:404,code:"SEALED_ARTIFACT_NOT_FOUND"});
 const signed=signSidecIntegrity(row.manifestHash,row.artifactHash);
 await db.query(`INSERT INTO sidec_artifact_attestations(
   export_id,organization_id,algorithm,key_id,signature,public_key,public_key_fingerprint,attested_by
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(export_id) DO NOTHING`,
 [id,org,signed.algorithm,signed.keyId,signed.signature,signed.publicKey,signed.publicKeyFingerprint,userId]);
 const result=await db.query(`SELECT export_id AS "exportId",algorithm,key_id AS "keyId",signature,
   public_key AS "publicKey",public_key_fingerprint AS "publicKeyFingerprint",attested_at AS "attestedAt"
   FROM sidec_artifact_attestations WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 return result.rows[0];
}

async function ensureSidecIntegrityTimestamp(org:string,id:string,userId:string|null){
 const current=await db.query(`SELECT export_id AS "exportId",statement_hash AS "statementHash",timestamped_at AS "timestampedAt",
   algorithm,key_id AS "keyId",signature,public_key AS "publicKey",public_key_fingerprint AS "publicKeyFingerprint"
   FROM sidec_integrity_timestamps WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 if(current.rows[0])return current.rows[0];

 const state=await db.query(`SELECT a.content_hash AS "artifactHash",a.manifest_hash AS "manifestHash",
   t.signature AS "attestationSignature"
   FROM sidec_export_artifacts a
   JOIN sidec_artifact_attestations t ON t.export_id=a.export_id
   WHERE a.export_id=$1 AND a.organization_id=$2`,[id,org]);
 const row=state.rows[0] as {artifactHash:string;manifestHash:string;attestationSignature:string}|undefined;
 if(!row)throw Object.assign(new Error("Atestação SIDEC não encontrada."),{statusCode:404,code:"ATTESTATION_NOT_FOUND"});
 const timestampedAt=new Date().toISOString();
 const signed=signSidecTimestamp({
  manifestHash:row.manifestHash,artifactHash:row.artifactHash,
  attestationSignature:row.attestationSignature,timestampedAt
 });
 await db.query(`INSERT INTO sidec_integrity_timestamps(
   export_id,organization_id,statement_hash,timestamped_at,algorithm,key_id,signature,public_key,public_key_fingerprint,created_by
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  ON CONFLICT(export_id) DO NOTHING`,
 [id,org,signed.statementHash,timestampedAt,signed.algorithm,signed.keyId,signed.signature,signed.publicKey,signed.publicKeyFingerprint,userId]);
 const result=await db.query(`SELECT export_id AS "exportId",statement_hash AS "statementHash",timestamped_at AS "timestampedAt",
   algorithm,key_id AS "keyId",signature,public_key AS "publicKey",public_key_fingerprint AS "publicKeyFingerprint"
   FROM sidec_integrity_timestamps WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 return result.rows[0];
}

function publicIntegrityUrl(artifactHash:string){
 const base=(process.env.SIGDEC_PUBLIC_URL??"http://localhost:3000").replace(/\/$/,"");
 return `${base}/integridade/${artifactHash}`;
}

async function sealSidecExportArtifact(org:string,id:string,userId:string){
 const existing=await db.query(`SELECT export_id AS "exportId",file_name AS "fileName",byte_size AS "byteSize",
   content_hash AS "contentHash",manifest_hash AS "manifestHash",signature_algorithm AS "signatureAlgorithm",
   manifest_signature AS "manifestSignature",signing_key_id AS "signingKeyId",signed_at AS "signedAt"
   FROM sidec_export_artifacts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 if(existing.rows[0]){await ensureSidecArtifactAttestation(org,id,userId);await ensureSidecIntegrityTimestamp(org,id,userId);return existing.rows[0];}

 const sourceResult=await db.query(`SELECT e.revision,e.schema_version AS "schemaVersion",e.snapshot,e.snapshot_hash AS "snapshotHash",
   e.manifest_hash AS "manifestHash",e.status,i.protocol
   FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
   WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
 const source=sourceResult.rows[0] as SidecZipSource|undefined;
 if(!source)throw Object.assign(new Error("Pacote SIDEC não encontrado."),{statusCode:404,code:"NOT_FOUND"});
 const built=await buildSidecZip(org,id,source,{signManifest:true});
 const manifestHash=built.manifestHash;
 const manifestSignature=built.manifestSignature;
 const signingKeyId=built.signingKeyId??currentSidecSigningKeyId();
 if(!manifestSignature)throw Object.assign(new Error("Falha ao assinar manifesto."),{statusCode:500,code:"MANIFEST_SIGNATURE_ERROR"});
 if(source.manifestHash&&source.manifestHash!==manifestHash)throw Object.assign(new Error("Manifesto alterado antes da selagem."),{statusCode:409,code:"MANIFEST_INTEGRITY_ERROR"});
 if(!source.manifestHash)await db.query("UPDATE sidec_exports SET manifest_hash=$1 WHERE id=$2 AND organization_id=$3 AND manifest_hash IS NULL",[manifestHash,id,org]);
 const contentHash=hashBinary(built.zip);
 await db.query(`INSERT INTO sidec_export_artifacts(
   export_id,organization_id,file_name,byte_size,content_hash,content,manifest_hash,signature_algorithm,manifest_signature,signing_key_id,signed_by
  ) VALUES($1,$2,$3,$4,$5,$6,$7,'HMAC-SHA256',$8,$9,$10)
  ON CONFLICT(export_id) DO NOTHING`,[id,org,built.fileName,built.zip.length,contentHash,built.zip,manifestHash,manifestSignature,signingKeyId,userId]);
 await db.query(`INSERT INTO sidec_artifact_retention(export_id,organization_id,retention_class,retain_until,updated_by)
  VALUES($1,$2,'UNSPECIFIED',NULL,$3)
  ON CONFLICT(export_id) DO NOTHING`,[id,org,userId]);
 await ensureSidecArtifactAttestation(org,id,userId);
 await ensureSidecIntegrityTimestamp(org,id,userId);
 const sealed=await db.query(`SELECT export_id AS "exportId",file_name AS "fileName",byte_size AS "byteSize",
   content_hash AS "contentHash",manifest_hash AS "manifestHash",signature_algorithm AS "signatureAlgorithm",
   manifest_signature AS "manifestSignature",signing_key_id AS "signingKeyId",signed_at AS "signedAt"
   FROM sidec_export_artifacts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
 return sealed.rows[0];
}

async function buildSidecIntegrityProof(org:string,id:string,userId:string){
 const artifactResult=await db.query(`SELECT e.id,e.revision,e.schema_version AS "schemaVersion",i.protocol,
   a.file_name AS "fileName",a.byte_size AS "byteSize",a.content_hash AS "artifactHash",a.content,
   a.manifest_hash AS "manifestHash",a.signature_algorithm AS "hmacAlgorithm",
   a.manifest_signature AS "hmacSignature",a.signing_key_id AS "hmacKeyId",a.signed_at AS "sealedAt"
   FROM sidec_exports e
   JOIN incidents i ON i.id=e.incident_id
   JOIN sidec_export_artifacts a ON a.export_id=e.id
   WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
 const row=artifactResult.rows[0] as any;
 if(!row)throw Object.assign(new Error("Artefato SIDEC selado não encontrado."),{statusCode:404,code:"SEALED_ARTIFACT_NOT_FOUND"});
 if(hashBinary(row.content)!==row.artifactHash)throw Object.assign(new Error("Hash do ZIP selado divergente."),{statusCode:409,code:"SEALED_ZIP_INTEGRITY_ERROR"});
 const attestation=await ensureSidecArtifactAttestation(org,id,userId) as any;
 if(!verifySidecIntegrity({
  manifestHash:row.manifestHash,artifactHash:row.artifactHash,signature:attestation.signature,
  publicKey:attestation.publicKey,publicKeyFingerprint:attestation.publicKeyFingerprint
 }))throw Object.assign(new Error("Atestação Ed25519 inválida."),{statusCode:409,code:"ED25519_ATTESTATION_INVALID"});
 const timestamp=await ensureSidecIntegrityTimestamp(org,id,userId) as any;
 const timestampValid=verifySidecTimestamp({
  manifestHash:row.manifestHash,artifactHash:row.artifactHash,attestationSignature:attestation.signature,
  timestampedAt:new Date(timestamp.timestampedAt).toISOString(),statementHash:timestamp.statementHash,
  signature:timestamp.signature,publicKey:timestamp.publicKey,publicKeyFingerprint:timestamp.publicKeyFingerprint
 });
 if(!timestampValid)throw Object.assign(new Error("Carimbo de tempo interno inválido."),{statusCode:409,code:"INTEGRITY_TIMESTAMP_INVALID"});
 return {
  proofVersion:"sigdec-sidec-integrity-proof/1.1" as const,
  export:{id:row.id,protocol:row.protocol,revision:Number(row.revision),schemaVersion:row.schemaVersion,sealedAt:new Date(row.sealedAt).toISOString()},
  artifact:{fileName:row.fileName,byteSize:Number(row.byteSize),sha256:row.artifactHash},
  manifest:{sha256:row.manifestHash},
  hmac:{algorithm:"HMAC-SHA256" as const,keyId:row.hmacKeyId,signature:row.hmacSignature},
  ed25519:{
   algorithm:"Ed25519" as const,keyId:attestation.keyId,signature:attestation.signature,
   publicKey:attestation.publicKey,publicKeyFingerprint:attestation.publicKeyFingerprint,
   attestedAt:new Date(attestation.attestedAt).toISOString()
  },
  publicVerificationUrl:publicIntegrityUrl(row.artifactHash),
  timestamp:{
   algorithm:"Ed25519" as const,keyId:timestamp.keyId,statementHash:timestamp.statementHash,
   timestampedAt:new Date(timestamp.timestampedAt).toISOString(),signature:timestamp.signature,
   publicKey:timestamp.publicKey,publicKeyFingerprint:timestamp.publicKeyFingerprint
  }
 };
}

async function recordArchiveVerification(input:{
 org:string;exportId:string;source:"SCHEDULED"|"MANUAL"|"ARCHIVE";
 bucket:string;key:string;versionId?:string|null;expectedHash:string;
}){
 const verification=await verifySidecArchive({bucket:input.bucket,key:input.key,versionId:input.versionId,expectedHash:input.expectedHash});
 await db.query(`INSERT INTO sidec_archive_verifications(
  export_id,organization_id,expected_hash,observed_hash,exists_remote,hash_valid,object_lock_mode,retain_until,legal_hold,
  verification_source,error_message
 ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[
  input.exportId,input.org,input.expectedHash,verification.observedHash,verification.existsRemote,verification.hashValid,
  verification.objectLockMode,verification.retainUntil,verification.legalHold,input.source,verification.errorMessage
 ]);
 return verification;
}

export async function evaluateSidecArchiveVerifications(organizationId?:string){
 const params:unknown[]=[];
 let where="";
 if(organizationId){params.push(organizationId);where="WHERE r.organization_id=$1";}
 const rows=await db.query(`SELECT r.export_id AS "exportId",r.organization_id AS "organizationId",r.bucket,
   r.object_key AS "objectKey",r.version_id AS "versionId",r.content_hash AS "contentHash"
   FROM sidec_archive_receipts r ${where}
   ORDER BY r.archived_at ASC LIMIT 500`,params);
 let checked=0,failed=0;
 for(const row of rows.rows as Array<any>){
  const result=await recordArchiveVerification({
   org:String(row.organizationId),exportId:String(row.exportId),source:"SCHEDULED",
   bucket:String(row.bucket),key:String(row.objectKey),versionId:row.versionId?String(row.versionId):null,expectedHash:String(row.contentHash)
  });
  checked++;
  if(!result.existsRemote||result.hashValid!==true)failed++;
 }
 return {checked,failed};
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

 app.get("/api/v1/sidec/document-requirements",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const query=request.query as {scopeType?:string;scopeValue?:string};
  const params:[string,...unknown[]]=[org];
  let where="organization_id=$1";
  if(query.scopeType){params.push(query.scopeType);where+=` AND scope_type=${params.length}`;}
  if(query.scopeValue){params.push(query.scopeValue);where+=` AND scope_value=${params.length}`;}
  const r=await db.query(`SELECT id,scope_type AS "scopeType",scope_value AS "scopeValue",document_type AS "documentType",
    label,min_count AS "minCount",required,enabled,created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sidec_document_requirements WHERE ${where}
    ORDER BY scope_type,scope_value,document_type`,params);
  return {items:r.rows};
 });

 app.put("/api/v1/sidec/document-requirements",{preHandler:requirePermission("sidec_document_requirements.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=documentRequirementsUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const scopeType=parsed.data.scopeType;
  const scopeValue=scopeType==="DEFAULT"?"*":parsed.data.scopeValue;
  const seen=new Set<string>();
  for(const item of parsed.data.items){
   if(seen.has(item.documentType))return reply.code(400).send({error:"DUPLICATE_DOCUMENT_TYPE",documentType:item.documentType});
   seen.add(item.documentType);
  }
  if(scopeType==="COBRADE"){
   const catalogCount=await db.query(`SELECT count(*)::int AS count FROM cobrade_catalog WHERE organization_id=$1 AND active=true`,[org]);
   if(Number(catalogCount.rows[0]?.count??0)>0){
    const valid=await db.query(`SELECT 1 FROM cobrade_catalog WHERE organization_id=$1 AND code=$2 AND active=true`,[org,scopeValue]);
    if(!valid.rows[0])return reply.code(400).send({error:"COBRADE_NOT_IN_CATALOG"});
   }
  }
  if(scopeType==="INCIDENT_TYPE"){
   const valid=await db.query(`SELECT 1 FROM incident_types WHERE code=$1 AND active=true`,[scopeValue]);
   if(!valid.rows[0])return reply.code(400).send({error:"INCIDENT_TYPE_NOT_FOUND"});
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const before=await client.query(`SELECT scope_type AS "scopeType",scope_value AS "scopeValue",document_type AS "documentType",
     label,min_count AS "minCount",required,enabled FROM sidec_document_requirements
     WHERE organization_id=$1 AND scope_type=$2 AND scope_value=$3 ORDER BY document_type`,[org,scopeType,scopeValue]);
   await client.query(`DELETE FROM sidec_document_requirements WHERE organization_id=$1 AND scope_type=$2 AND scope_value=$3`,[org,scopeType,scopeValue]);
   for(const item of parsed.data.items){
    await client.query(`INSERT INTO sidec_document_requirements(
      organization_id,scope_type,scope_value,document_type,label,min_count,required,enabled,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [org,scopeType,scopeValue,item.documentType,item.label,item.minCount,item.required,item.enabled,auth.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,ip,user_agent,before_data,after_data,metadata)
     VALUES($1,'sidec_document_requirements.replace','sidec_document_requirements',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
    [auth.userId,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows),JSON.stringify(parsed.data.items),JSON.stringify({scopeType,scopeValue})]);
   await client.query("COMMIT");
   return {scopeType,scopeValue,items:parsed.data.items};
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
  const typeCode=String(row.typeCode??"").trim()||null;
  const [cobradeRequirements,documentRequirements,documents]=await Promise.all([
   effectiveCobradeRequirements(org,cobradeCode),
   effectiveDocumentRequirements(org,cobradeCode,typeCode),
   db.query(`SELECT id,number,title,document_type AS "documentType",revision,content_hash AS "contentHash",issued_at AS "issuedAt"
     FROM technical_documents
     WHERE organization_id=$1 AND incident_id=$2 AND status='ISSUED'
     ORDER BY issued_at DESC,created_at DESC`,[org,id])
  ]);
  const availableDocuments=documents.rows as Array<Record<string,unknown>&SidecAvailableDocument>;
  const effectiveDocs=mergeDocumentRequirements(documentRequirements);
  const checks=[
   ...evaluateSidecReadiness(root,mappings),
   ...evaluateCobradeRequirements(root,cobradeRequirements),
   ...evaluateDocumentRequirements(availableDocuments,effectiveDocs)
  ];
  return {
   ready:isSidecReady(checks),checks,mappings,cobradeCode,typeCode,cobradeRequirements,
   documentRequirements:effectiveDocs,
   requiredDocumentIds:chooseRequiredDocumentIds(availableDocuments,effectiveDocs),
   availableDocuments:documents.rows,
   mappedFields:buildMappedFields(root,mappings)
  };
 });

 app.get("/api/v1/sidec-exports",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const r=await db.query(`SELECT e.id,e.incident_id AS "incidentId",i.protocol,i.summary,e.revision,e.schema_version AS "schemaVersion",e.status,
    e.snapshot_hash AS "snapshotHash",e.manifest_hash AS "manifestHash",e.external_protocol AS "externalProtocol",e.external_notes AS "externalNotes",
    e.exported_at AS "exportedAt",e.submitted_at AS "submittedAt",e.acknowledged_at AS "acknowledgedAt",
    e.rejected_at AS "rejectedAt",e.created_at AS "createdAt",e.updated_at AS "updatedAt",
    (a.export_id IS NOT NULL) AS "artifactSealed",a.content_hash AS "artifactHash",a.manifest_signature AS "manifestSignature",a.signed_at AS "artifactSignedAt"
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    LEFT JOIN sidec_export_artifacts a ON a.export_id=e.id
    WHERE e.organization_id=$1 ORDER BY
      CASE e.status WHEN 'SUBMITTED' THEN 1 WHEN 'READY' THEN 2 WHEN 'EXPORTED' THEN 3 WHEN 'REJECTED' THEN 4 ELSE 5 END,
      e.updated_at DESC LIMIT 300`,[org]);
  return {items:r.rows};
 });
 app.get("/api/v1/sidec/deadline-policies",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  return {items:await effectiveDeadlinePolicies(org)};
 });

 app.put("/api/v1/sidec/deadline-policies",{preHandler:requirePermission("sidec_deadlines.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId);
  const parsed=deadlinePoliciesUpdateSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const seen=new Set<string>();
  for(const item of parsed.data.items){
   if(seen.has(item.pendingStatus))return reply.code(400).send({error:"DUPLICATE_PENDING_STATUS",pendingStatus:item.pendingStatus});
   seen.add(item.pendingStatus);
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const before=await client.query(`SELECT pending_status AS "pendingStatus",warning_after_hours AS "warningAfterHours",severity,enabled
     FROM sidec_deadline_policies WHERE organization_id=$1 ORDER BY pending_status`,[org]);
   await client.query("DELETE FROM sidec_deadline_policies WHERE organization_id=$1",[org]);
   for(const item of parsed.data.items){
    await client.query(`INSERT INTO sidec_deadline_policies(
      organization_id,pending_status,warning_after_hours,severity,enabled,created_by
    ) VALUES($1,$2,$3,$4,$5,$6)`,[org,item.pendingStatus,item.warningAfterHours,item.severity,item.enabled,auth.userId]);
   }
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,ip,user_agent,before_data,after_data)
     VALUES($1,'sidec_deadline_policies.replace','sidec_deadline_policies',$2,$3,$4::jsonb,$5::jsonb)`,
    [auth.userId,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows),JSON.stringify(parsed.data.items)]);
   await client.query("COMMIT");
   await evaluateSidecDeadlineAlerts(org);
   return {items:await effectiveDeadlinePolicies(org)};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
 });

 app.get("/api/v1/sidec/deadline-alerts",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  await evaluateSidecDeadlineAlerts(org);
  const open=String((request.query as {open?:string})?.open??"true")!=="false";
  const r=await db.query(`SELECT a.id,a.incident_id AS "incidentId",a.export_id AS "exportId",i.protocol,i.summary,
    e.revision,a.pending_status AS "pendingStatus",a.severity,a.due_at AS "dueAt",a.detected_at AS "detectedAt",
    a.acknowledged_at AS "acknowledgedAt",u.display_name AS "acknowledgedByName"
    FROM sidec_deadline_alerts a
    JOIN incidents i ON i.id=a.incident_id
    JOIN sidec_exports e ON e.id=a.export_id
    LEFT JOIN users u ON u.id=a.acknowledged_by
    WHERE a.organization_id=$1 AND (
      $2::boolean=false OR (
       a.acknowledged_at IS NULL AND (
        (a.pending_status='PACKAGE_READY' AND e.status='READY') OR
        (a.pending_status='AWAITING_PROTOCOL' AND e.status='EXPORTED') OR
        (a.pending_status='AWAITING_RETURN' AND e.status='SUBMITTED') OR
        (a.pending_status='REJECTED' AND e.status='REJECTED')
       ) AND e.revision=(SELECT max(e2.revision) FROM sidec_exports e2 WHERE e2.incident_id=e.incident_id AND e2.organization_id=a.organization_id)
      )
    )
    ORDER BY (a.acknowledged_at IS NULL) DESC,a.due_at ASC,a.detected_at DESC LIMIT 300`,[org,open]);
  return {items:r.rows};
 });

 app.patch("/api/v1/sidec/deadline-alerts/:id/ack",{preHandler:requirePermission("sidec_deadlines.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const before=await db.query(`SELECT id,acknowledged_at AS "acknowledgedAt" FROM sidec_deadline_alerts WHERE id=$1 AND organization_id=$2`,[id,org]);
  if(!before.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`UPDATE sidec_deadline_alerts SET acknowledged_at=COALESCE(acknowledged_at,now()),
    acknowledged_by=CASE WHEN acknowledged_at IS NULL THEN $1 ELSE acknowledged_by END
    WHERE id=$2 AND organization_id=$3 RETURNING id,acknowledged_at AS "acknowledgedAt"`,[auth.userId,id,org]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_deadline_alert.ack','sidec_deadline_alert',$2,$3,$4,$5::jsonb,$6::jsonb)`,
   [auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });

 app.get("/api/v1/sidec-exports/:id/retention",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const r=await db.query(`SELECT r.export_id AS "exportId",r.retention_class AS "retentionClass",r.retain_until AS "retainUntil",
    r.legal_hold AS "legalHold",r.notes,r.created_at AS "createdAt",r.updated_at AS "updatedAt",
    a.file_name AS "fileName",a.content_hash AS "contentHash",a.signing_key_id AS "signingKeyId",a.signed_at AS "signedAt"
    FROM sidec_artifact_retention r JOIN sidec_export_artifacts a ON a.export_id=r.export_id
    WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org]);
  if(!r.rows[0])return reply.code(404).send({error:"SEALED_ARTIFACT_NOT_FOUND"});
  return r.rows[0];
 });

 app.patch("/api/v1/sidec-exports/:id/retention",{preHandler:requirePermission("sidec_retention.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=retentionSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const before=await db.query(`SELECT r.export_id AS "exportId",r.retention_class AS "retentionClass",r.retain_until AS "retainUntil",
    r.legal_hold AS "legalHold",r.notes,a.signed_at AS "signedAt"
    FROM sidec_artifact_retention r JOIN sidec_export_artifacts a ON a.export_id=r.export_id
    WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org]);
  const archived=await db.query("SELECT 1 FROM sidec_archive_receipts WHERE export_id=$1 AND organization_id=$2",[id,org]);
  if(archived.rows[0])return reply.code(409).send({error:"ARCHIVE_RETENTION_LOCKED"});
  const current=before.rows[0] as {signedAt:string}|undefined;
  if(!current)return reply.code(404).send({error:"SEALED_ARTIFACT_NOT_FOUND"});
  if(parsed.data.retainUntil&&parsed.data.retainUntil.getTime()<new Date(current.signedAt).getTime()){
   return reply.code(400).send({error:"RETENTION_BEFORE_SEAL"});
  }
  const legalHold=parsed.data.retentionClass==="LEGAL_HOLD"?true:parsed.data.legalHold;
  const r=await db.query(`UPDATE sidec_artifact_retention SET retention_class=$1,retain_until=$2,legal_hold=$3,
    notes=$4,updated_by=$5,updated_at=now()
    WHERE export_id=$6 AND organization_id=$7
    RETURNING export_id AS "exportId",retention_class AS "retentionClass",retain_until AS "retainUntil",
      legal_hold AS "legalHold",notes,updated_at AS "updatedAt"`,
    [parsed.data.retentionClass,parsed.data.retainUntil??null,legalHold,parsed.data.notes??null,auth.userId,id,org]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_artifact_retention.update','sidec_artifact_retention',$2,$3,$4,$5::jsonb,$6::jsonb)`,
   [auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return r.rows[0];
 });

 app.get("/api/v1/sidec/pending",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const incidents=await db.query(`SELECT i.id AS "incidentId",i.protocol,i.summary,i.status AS "incidentStatus",i.priority,
    i.risk_to_life AS "riskToLife",i.description,i.source,i.address_line AS "addressLine",i.neighborhood,
    i.reference_point AS "referencePoint",i.latitude,i.longitude,i.created_at AS "createdAt",i.updated_at AS "updatedAt",
    t.code AS "typeCode",t.name AS "typeName",t.group_name AS "typeGroup",t.cobrade_code AS "cobradeCode",
    latest.id AS "exportId",latest.revision,latest.status AS "exportStatus",latest.external_protocol AS "externalProtocol",
    latest.created_at AS "exportCreatedAt",latest.updated_at AS "exportUpdatedAt",latest.exported_at AS "exportedAt",
    latest.submitted_at AS "submittedAt",latest.rejected_at AS "rejectedAt",(artifact.export_id IS NOT NULL) AS "artifactSealed"
   FROM incidents i
   JOIN incident_types t ON t.id=i.incident_type_id
   LEFT JOIN LATERAL (
    SELECT e.id,e.revision,e.status,e.external_protocol,e.created_at,e.updated_at,e.exported_at,e.submitted_at,e.rejected_at
    FROM sidec_exports e WHERE e.incident_id=i.id AND e.organization_id=$1
    ORDER BY e.revision DESC LIMIT 1
   ) latest ON true
   LEFT JOIN sidec_export_artifacts artifact ON artifact.export_id=latest.id
   WHERE i.organization_id=$1 AND i.status NOT IN ('CLOSED','CANCELLED','DUPLICATE')
   ORDER BY i.updated_at DESC LIMIT 200`,[org]);

  const [mappings,deadlinePolicies]=await Promise.all([effectiveMappings(org),effectiveDeadlinePolicies(org)]);
  const allCobrade=await db.query(`SELECT cobrade_code AS "cobradeCode",source_path AS "sourcePath",label,required,enabled,sort_order AS "sortOrder"
    FROM sidec_cobrade_requirements WHERE organization_id=$1 AND enabled=true ORDER BY cobrade_code,sort_order`,[org]);
  const allDocRules=await db.query(`SELECT scope_type AS "scopeType",scope_value AS "scopeValue",document_type AS "documentType",
    label,min_count AS "minCount",required,enabled
    FROM sidec_document_requirements WHERE organization_id=$1 AND enabled=true`,[org]);
  const ids=incidents.rows.map((row:any)=>row.incidentId);
  const documentRows=ids.length?await db.query(`SELECT incident_id AS "incidentId",id,document_type AS "documentType",issued_at AS "issuedAt"
    FROM technical_documents WHERE organization_id=$1 AND status='ISSUED' AND incident_id=ANY($2::uuid[])`,[org,ids]):{rows:[]};
  const docsByIncident=new Map<string,SidecAvailableDocument[]>();
  for(const doc of documentRows.rows as Array<any>){
   const list=docsByIncident.get(String(doc.incidentId))??[];
   list.push({id:String(doc.id),documentType:String(doc.documentType),issuedAt:doc.issuedAt?String(doc.issuedAt):null});
   docsByIncident.set(String(doc.incidentId),list);
  }

  const items:Array<Record<string,unknown>>=[];
  for(const row of incidents.rows as Array<any>){
   let pendingStatus:string|null=null;
   let missing:string[]=[];
   if(row.exportStatus==="READY")pendingStatus="PACKAGE_READY";
   else if(row.exportStatus==="EXPORTED")pendingStatus="AWAITING_PROTOCOL";
   else if(row.exportStatus==="SUBMITTED")pendingStatus="AWAITING_RETURN";
   else if(row.exportStatus==="REJECTED")pendingStatus="REJECTED";
   else if(row.exportStatus==="CANCELLED")pendingStatus="READY_TO_PACKAGE";
   else if(!row.exportStatus){
    const root=incidentRoot(row);
    const cobradeRules=(allCobrade.rows as Array<any>).filter(rule=>String(rule.cobradeCode)===String(row.cobradeCode??"")) as CobradeRequirement[];
    const docRules=(allDocRules.rows as Array<any>).filter(rule=>
      (rule.scopeType==="DEFAULT"&&rule.scopeValue==="*")||
      (rule.scopeType==="COBRADE"&&String(rule.scopeValue)===String(row.cobradeCode??""))||
      (rule.scopeType==="INCIDENT_TYPE"&&String(rule.scopeValue)===String(row.typeCode??""))
    ) as SidecDocumentRequirement[];
    const checks=[
     ...evaluateSidecReadiness(root,mappings),
     ...evaluateCobradeRequirements(root,cobradeRules),
     ...evaluateDocumentRequirements(docsByIncident.get(String(row.incidentId))??[],docRules)
    ];
    const failed=checks.filter(check=>check.required&&!check.ok);
    pendingStatus=failed.length?"NOT_READY":"READY_TO_PACKAGE";
    missing=failed.map(check=>check.label);
   }
   if(!pendingStatus)continue;
   const deadline=row.exportStatus?sidecDueAt({
    status:row.exportStatus,createdAt:row.exportCreatedAt,updatedAt:row.exportUpdatedAt,
    exportedAt:row.exportedAt,submittedAt:row.submittedAt,rejectedAt:row.rejectedAt
   },deadlinePolicies):null;
   items.push({
    incidentId:row.incidentId,protocol:row.protocol,summary:row.summary,priority:row.priority,
    typeCode:row.typeCode,cobradeCode:row.cobradeCode,pendingStatus,missing,
    exportId:row.exportId??null,revision:row.revision??null,exportStatus:row.exportStatus??null,
    externalProtocol:row.externalProtocol??null,artifactSealed:Boolean(row.artifactSealed),
    dueAt:deadline?.dueAt.toISOString()??null,severity:deadline?.severity??null,
    overdue:deadline?isSidecDeadlineOverdue(deadline.dueAt):false,
    updatedAt:row.exportUpdatedAt??row.updatedAt
   });
  }
  const summary=items.reduce<Record<string,number>>((acc,item)=>{
   const key=String(item.pendingStatus);acc[key]=(acc[key]??0)+1;return acc;
  },{});
  return {summary,items};
 });

 app.get("/api/v1/incidents/:id/sidec-exports",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const incident=await db.query("SELECT 1 FROM incidents WHERE id=$1 AND organization_id=$2",[id,org]);
  if(!incident.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT e.id,e.revision,e.schema_version AS "schemaVersion",e.status,e.snapshot_hash AS "snapshotHash",e.manifest_hash AS "manifestHash",
    e.external_protocol AS "externalProtocol",e.external_notes AS "externalNotes",e.exported_at AS "exportedAt",
    e.submitted_at AS "submittedAt",e.acknowledged_at AS "acknowledgedAt",e.rejected_at AS "rejectedAt",
    e.created_at AS "createdAt",e.updated_at AS "updatedAt",
    (a.export_id IS NOT NULL) AS "artifactSealed",a.content_hash AS "artifactHash",a.manifest_signature AS "manifestSignature",
    a.signing_key_id AS "signingKeyId",a.signed_at AS "artifactSignedAt",
    t.key_id AS "ed25519KeyId",t.public_key_fingerprint AS "ed25519Fingerprint",t.attested_at AS "ed25519AttestedAt",
    ar.retention_class AS "retentionClass",ar.retain_until AS "retainUntil",ar.legal_hold AS "legalHold",ar.notes AS "retentionNotes",
    (wr.export_id IS NOT NULL) AS "archiveCreated",wr.bucket AS "archiveBucket",wr.object_key AS "archiveObjectKey",
    wr.object_lock_mode AS "archiveLockMode",wr.retain_until AS "archiveRetainUntil",wr.legal_hold AS "archiveLegalHold",
    wr.archived_at AS "archivedAt",wv.exists_remote AS "archiveExistsRemote",wv.hash_valid AS "archiveHashValid",
    wv.verified_at AS "archiveVerifiedAt",wv.error_message AS "archiveVerificationError",
    COALESCE((SELECT json_agg(json_build_object(
      'id',d.document_id,'number',d.document_number,'title',d.document_title,'documentType',d.document_type,
      'revision',d.document_revision,'contentHash',d.content_hash
    ) ORDER BY d.document_title) FROM sidec_export_documents d WHERE d.export_id=e.id),'[]'::json) AS documents
    FROM sidec_exports e
    LEFT JOIN sidec_export_artifacts a ON a.export_id=e.id
    LEFT JOIN sidec_artifact_attestations t ON t.export_id=e.id
    LEFT JOIN sidec_artifact_retention ar ON ar.export_id=e.id
    LEFT JOIN sidec_archive_receipts wr ON wr.export_id=e.id
    LEFT JOIN LATERAL (
      SELECT exists_remote,hash_valid,verified_at,error_message
      FROM sidec_archive_verifications av WHERE av.export_id=e.id
      ORDER BY verified_at DESC LIMIT 1
    ) wv ON true
    WHERE e.incident_id=$1 AND e.organization_id=$2 ORDER BY e.revision DESC`,[id,org]);
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
  const typeCode=String(incidentRow.typeCode??"").trim()||null;
  const [cobradeRequirements,documentRequirements,availableDocumentsResult]=await Promise.all([
   effectiveCobradeRequirements(org,cobradeCode),
   effectiveDocumentRequirements(org,cobradeCode,typeCode),
   db.query(`SELECT id,number,title,document_type AS "documentType",revision,content_hash AS "contentHash",issued_at AS "issuedAt"
     FROM technical_documents
     WHERE organization_id=$1 AND incident_id=$2 AND status='ISSUED'
     ORDER BY issued_at DESC,created_at DESC`,[org,id])
  ]);
  const availableDocuments=availableDocumentsResult.rows as Array<Record<string,unknown>&SidecAvailableDocument>;
  const effectiveDocs=mergeDocumentRequirements(documentRequirements);
  const checks=[
   ...evaluateSidecReadiness(root,mappings),
   ...evaluateCobradeRequirements(root,cobradeRequirements),
   ...evaluateDocumentRequirements(availableDocuments,effectiveDocs)
  ];
  if(!isSidecReady(checks))return reply.code(409).send({error:"NOT_READY",checks,cobradeCode,typeCode,cobradeRequirements,documentRequirements:effectiveDocs});

  const selectedDocuments={rows:availableDocumentsResult.rows.filter((document:any)=>documentIds.includes(String(document.id)))};
  if(selectedDocuments.rows.length!==documentIds.length)return reply.code(400).send({error:"INVALID_DOCUMENT_SELECTION"});
  const documentSelectionChecks=evaluateDocumentRequirements(availableDocuments,effectiveDocs,documentIds);
  if(!isSidecReady(documentSelectionChecks))return reply.code(409).send({
   error:"DOCUMENT_REQUIREMENTS_NOT_MET",
   checks:documentSelectionChecks,
   requiredDocumentIds:chooseRequiredDocumentIds(availableDocuments,effectiveDocs)
  });

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
  const readinessSnapshot={ready:true,checks:[...checks,...documentSelectionChecks],mappings,cobradeCode,typeCode,cobradeRequirements,documentRequirements:effectiveDocs};
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

 app.get("/api/v1/sidec-exports/:id/archive",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const r=await db.query(`SELECT r.export_id AS "exportId",r.bucket,r.object_key AS "objectKey",r.version_id AS "versionId",
    r.etag,r.storage_class AS "storageClass",r.object_lock_mode AS "objectLockMode",r.retain_until AS "retainUntil",
    r.legal_hold AS "legalHold",r.content_hash AS "contentHash",r.archived_at AS "archivedAt",
    v.exists_remote AS "existsRemote",v.hash_valid AS "hashValid",v.observed_hash AS "observedHash",
    v.verified_at AS "verifiedAt",v.error_message AS "verificationError"
   FROM sidec_archive_receipts r
   LEFT JOIN LATERAL (
    SELECT * FROM sidec_archive_verifications x WHERE x.export_id=r.export_id ORDER BY x.verified_at DESC LIMIT 1
   ) v ON true
   WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org]);
  if(!r.rows[0])return reply.code(404).send({error:"ARCHIVE_NOT_FOUND"});
  return r.rows[0];
 });

 app.post("/api/v1/sidec-exports/:id/archive",{preHandler:requirePermission("sidec_archive.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const existing=await db.query(`SELECT export_id AS "exportId",bucket,object_key AS "objectKey",content_hash AS "contentHash",
    object_lock_mode AS "objectLockMode",retain_until AS "retainUntil",legal_hold AS "legalHold",archived_at AS "archivedAt"
    FROM sidec_archive_receipts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
  if(existing.rows[0])return existing.rows[0];

  const source=await db.query(`SELECT a.file_name AS "fileName",a.content_hash AS "contentHash",a.manifest_hash AS "manifestHash",a.content,
    r.retention_class AS "retentionClass",r.retain_until AS "retainUntil",r.legal_hold AS "legalHold",
    e.incident_id AS "incidentId",e.revision
   FROM sidec_export_artifacts a
   JOIN sidec_exports e ON e.id=a.export_id
   LEFT JOIN sidec_artifact_retention r ON r.export_id=a.export_id
   WHERE a.export_id=$1 AND a.organization_id=$2`,[id,org]);
  const item=source.rows[0] as any;
  if(!item)return reply.code(404).send({error:"SEALED_ARTIFACT_NOT_FOUND"});
  if(!item.retentionClass||item.retentionClass==="UNSPECIFIED")return reply.code(409).send({error:"RETENTION_POLICY_REQUIRED"});
  if(!item.retainUntil&&!item.legalHold)return reply.code(409).send({error:"RETENTION_DATE_OR_LEGAL_HOLD_REQUIRED"});

  const archived=await archiveSidecArtifact({
   content:item.content,artifactHash:item.contentHash,manifestHash:item.manifestHash,fileName:item.fileName,
   retention:{retainUntil:item.retainUntil?new Date(item.retainUntil):null,legalHold:Boolean(item.legalHold)}
  });
  const inserted=await db.query(`INSERT INTO sidec_archive_receipts(
    export_id,organization_id,bucket,object_key,version_id,etag,storage_class,object_lock_mode,retain_until,legal_hold,content_hash,archived_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
   ON CONFLICT(export_id) DO NOTHING
   RETURNING export_id AS "exportId",bucket,object_key AS "objectKey",version_id AS "versionId",etag,
    storage_class AS "storageClass",object_lock_mode AS "objectLockMode",retain_until AS "retainUntil",
    legal_hold AS "legalHold",content_hash AS "contentHash",archived_at AS "archivedAt"`,[
    id,org,archived.bucket,archived.key,archived.versionId,archived.etag,archived.storageClass,
    archived.objectLockMode,archived.retainUntil,archived.legalHold,item.contentHash,auth.userId
  ]);
  const receipt=inserted.rows[0]??(await db.query(`SELECT export_id AS "exportId",bucket,object_key AS "objectKey",
    version_id AS "versionId",content_hash AS "contentHash",object_lock_mode AS "objectLockMode",retain_until AS "retainUntil",
    legal_hold AS "legalHold",archived_at AS "archivedAt" FROM sidec_archive_receipts WHERE export_id=$1`,[id])).rows[0];
  const verification=await recordArchiveVerification({
   org,exportId:id,source:"ARCHIVE",bucket:receipt.bucket,key:receipt.objectKey,versionId:receipt.versionId??null,expectedHash:item.contentHash
  });
  await db.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
   VALUES($1,'sidec_archive.created',$2,$3,$4::jsonb)`,[
   item.incidentId,auth.userId,`Pacote SIDEC revisão ${item.revision} arquivado em Object Lock.`,
   JSON.stringify({exportId:id,bucket:receipt.bucket,objectKey:receipt.objectKey,hashValid:verification.hashValid})
  ]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
   VALUES($1,'sidec_archive.create','sidec_archive_receipt',$2,$3,$4,$5::jsonb,$6::jsonb)`,[
   auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(receipt),
   JSON.stringify({hashValid:verification.hashValid,existsRemote:verification.existsRemote})
  ]);
  if(!verification.existsRemote||verification.hashValid!==true){
   return reply.code(502).send({error:"WORM_ARCHIVE_VERIFICATION_FAILED",receipt,verification});
  }
  return reply.code(201).send({receipt,verification});
 });

 app.post("/api/v1/sidec-exports/:id/archive/verify",{preHandler:requirePermission("sidec_archive.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const receipt=await db.query(`SELECT export_id AS "exportId",bucket,object_key AS "objectKey",version_id AS "versionId",content_hash AS "contentHash"
   FROM sidec_archive_receipts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
  const item=receipt.rows[0] as any;
  if(!item)return reply.code(404).send({error:"ARCHIVE_NOT_FOUND"});
  const verification=await recordArchiveVerification({
   org,exportId:id,source:"MANUAL",bucket:item.bucket,key:item.objectKey,versionId:item.versionId??null,expectedHash:item.contentHash
  });
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
   VALUES($1,'sidec_archive.verify','sidec_archive_receipt',$2,$3,$4,$5::jsonb)`,[
   auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(verification)
  ]);
  return verification;
 });

 app.post("/api/v1/sidec-exports/:id/archive/extend-retention",{preHandler:requirePermission("sidec_archive.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=archiveRetentionExtensionSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const currentResult=await db.query(`SELECT r.export_id AS "exportId",r.bucket,r.object_key AS "objectKey",r.version_id AS "versionId",
    r.object_lock_mode AS "objectLockMode",r.retain_until AS "retainUntil",r.legal_hold AS "legalHold",
    e.incident_id AS "incidentId",e.revision
    FROM sidec_archive_receipts r JOIN sidec_exports e ON e.id=r.export_id
    WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org]);
  const current=currentResult.rows[0] as any;
  if(!current)return reply.code(404).send({error:"ARCHIVE_NOT_FOUND"});
  const previous=current.retainUntil?new Date(current.retainUntil):null;
  if(previous&&parsed.data.retainUntil.getTime()<=previous.getTime()){
   return reply.code(409).send({error:"RETENTION_EXTENSION_REQUIRED",currentRetainUntil:previous.toISOString()});
  }
  const mode=(current.objectLockMode??wormMode()) as "GOVERNANCE"|"COMPLIANCE";
  await extendSidecArchiveRetention({
   bucket:current.bucket,key:current.objectKey,versionId:current.versionId??null,mode,retainUntil:parsed.data.retainUntil
  });
  const verification=await recordArchiveVerification({
   org,exportId:id,source:"MANUAL",bucket:current.bucket,key:current.objectKey,versionId:current.versionId??null,
   expectedHash:(await db.query("SELECT content_hash AS hash FROM sidec_archive_receipts WHERE export_id=$1",[id])).rows[0].hash
  });
  if(!verification.existsRemote||verification.hashValid!==true)return reply.code(502).send({error:"WORM_RETENTION_VERIFICATION_FAILED",verification});
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query(`UPDATE sidec_archive_receipts SET object_lock_mode=$1,retain_until=$2 WHERE export_id=$3 AND organization_id=$4`,
    [mode,parsed.data.retainUntil,id,org]);
   await client.query(`UPDATE sidec_artifact_retention SET retain_until=$1,updated_by=$2,updated_at=now()
    WHERE export_id=$3 AND organization_id=$4`,[parsed.data.retainUntil,auth.userId,id,org]);
   await client.query(`INSERT INTO sidec_archive_policy_events(
    export_id,organization_id,event_type,previous_retain_until,new_retain_until,previous_legal_hold,new_legal_hold,reason,actor_user_id
   ) VALUES($1,$2,'RETENTION_EXTENDED',$3,$4,$5,$5,$6,$7)`,
    [id,org,previous,parsed.data.retainUntil,Boolean(current.legalHold),parsed.data.reason,auth.userId]);
   await client.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
    VALUES($1,'sidec_archive.retention_extended',$2,$3,$4::jsonb)`,[
    current.incidentId,auth.userId,`Retenção WORM da revisão ${current.revision} estendida.`,
    JSON.stringify({exportId:id,previousRetainUntil:previous?.toISOString()??null,newRetainUntil:parsed.data.retainUntil.toISOString(),reason:parsed.data.reason})
   ]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
    VALUES($1,'sidec_archive.retention_extend','sidec_archive_receipt',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(current),
    JSON.stringify({objectLockMode:mode,retainUntil:parsed.data.retainUntil.toISOString(),legalHold:Boolean(current.legalHold)}),
    JSON.stringify({reason:parsed.data.reason,verification})
   ]);
   await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
  return {objectLockMode:mode,retainUntil:parsed.data.retainUntil.toISOString(),legalHold:Boolean(current.legalHold),verification};
 });

 app.post("/api/v1/sidec-exports/:id/archive/enable-legal-hold",{preHandler:requirePermission("sidec_archive.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=archiveLegalHoldEnableSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
  const currentResult=await db.query(`SELECT r.export_id AS "exportId",r.bucket,r.object_key AS "objectKey",r.version_id AS "versionId",
    r.object_lock_mode AS "objectLockMode",r.retain_until AS "retainUntil",r.legal_hold AS "legalHold",
    e.incident_id AS "incidentId",e.revision
    FROM sidec_archive_receipts r JOIN sidec_exports e ON e.id=r.export_id
    WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org]);
  const current=currentResult.rows[0] as any;
  if(!current)return reply.code(404).send({error:"ARCHIVE_NOT_FOUND"});
  if(current.legalHold)return {legalHold:true,alreadyEnabled:true};
  await enableSidecArchiveLegalHold({bucket:current.bucket,key:current.objectKey,versionId:current.versionId??null});
  const expectedHash=(await db.query("SELECT content_hash AS hash FROM sidec_archive_receipts WHERE export_id=$1",[id])).rows[0].hash;
  const verification=await recordArchiveVerification({
   org,exportId:id,source:"MANUAL",bucket:current.bucket,key:current.objectKey,versionId:current.versionId??null,expectedHash
  });
  if(!verification.existsRemote||verification.hashValid!==true||verification.legalHold!==true){
   return reply.code(502).send({error:"WORM_LEGAL_HOLD_VERIFICATION_FAILED",verification});
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   await client.query(`UPDATE sidec_archive_receipts SET legal_hold=true WHERE export_id=$1 AND organization_id=$2`,[id,org]);
   await client.query(`UPDATE sidec_artifact_retention SET legal_hold=true,
     retention_class=CASE WHEN retention_class='UNSPECIFIED' THEN 'LEGAL_HOLD' ELSE retention_class END,
     updated_by=$1,updated_at=now() WHERE export_id=$2 AND organization_id=$3`,[auth.userId,id,org]);
   await client.query(`INSERT INTO sidec_archive_policy_events(
    export_id,organization_id,event_type,previous_retain_until,new_retain_until,previous_legal_hold,new_legal_hold,reason,actor_user_id
   ) VALUES($1,$2,'LEGAL_HOLD_ENABLED',$3,$3,false,true,$4,$5)`,
    [id,org,current.retainUntil??null,parsed.data.reason,auth.userId]);
   await client.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
    VALUES($1,'sidec_archive.legal_hold_enabled',$2,$3,$4::jsonb)`,[
    current.incidentId,auth.userId,`Legal hold ativado para o arquivo WORM da revisão ${current.revision}.`,
    JSON.stringify({exportId:id,reason:parsed.data.reason})
   ]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
    VALUES($1,'sidec_archive.legal_hold_enable','sidec_archive_receipt',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[
    auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(current),
    JSON.stringify({...current,legalHold:true}),JSON.stringify({reason:parsed.data.reason,verification})
   ]);
   await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
  return {legalHold:true,verification};
 });

 app.get("/api/v1/sidec/archive-health",{preHandler:requirePermission("sidec_exports.read")},async(request)=>{
  const org=organizationId(authFrom(request).organizationId);
  const staleHours=Math.max(1,Math.min(8760,Number(process.env.SIDEC_WORM_STALE_HOURS??48)));
  const r=await db.query(`SELECT ar.export_id AS "exportId",e.incident_id AS "incidentId",i.protocol,i.summary,e.revision,
    ar.archived_at AS "archivedAt",ar.object_lock_mode AS "objectLockMode",ar.retain_until AS "retainUntil",
    ar.legal_hold AS "legalHold",v.exists_remote AS "existsRemote",v.hash_valid AS "hashValid",
    v.verified_at AS "verifiedAt",v.error_message AS "errorMessage",
    CASE
      WHEN v.id IS NULL THEN 'STALE'
      WHEN v.exists_remote=false OR v.hash_valid=false THEN 'CRITICAL'
      WHEN v.verified_at < now()-($2::text||' hours')::interval THEN 'STALE'
      ELSE 'HEALTHY'
    END AS health
   FROM sidec_archive_receipts ar
   JOIN sidec_exports e ON e.id=ar.export_id
   JOIN incidents i ON i.id=e.incident_id
   LEFT JOIN LATERAL (
    SELECT id,exists_remote,hash_valid,verified_at,error_message
    FROM sidec_archive_verifications x WHERE x.export_id=ar.export_id
    ORDER BY verified_at DESC LIMIT 1
   ) v ON true
   WHERE ar.organization_id=$1
   ORDER BY CASE
      WHEN v.exists_remote=false OR v.hash_valid=false THEN 1
      WHEN v.id IS NULL OR v.verified_at < now()-($2::text||' hours')::interval THEN 2
      ELSE 3
    END,v.verified_at NULLS FIRST,ar.archived_at DESC`,[org,staleHours]);
  const items=r.rows;
  const summary=items.reduce<Record<string,number>>((acc:any,row:any)=>{acc[row.health]=(acc[row.health]??0)+1;return acc;},{});
  return {staleHours,summary,items};
 });

 app.get("/api/v1/sidec-exports/:id/integrity-proof",{preHandler:requirePermission("sidec_integrity.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const proof=await buildSidecIntegrityProof(org,id,auth.userId);
  const download=String((request.query as {download?:string})?.download??"").trim()==="1";
  if(download){
   const safeProtocol=proof.export.protocol.replace(/[^A-Za-z0-9_-]/g,"_");
   reply.header("Content-Type","application/json; charset=utf-8");
   reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${proof.export.revision}-integridade.json"`);
  }
  return proof;
 });

 app.get("/api/v1/sidec-exports/:id/integrity-evidence",{preHandler:requirePermission("sidec_integrity.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const proof=await buildSidecIntegrityProof(org,id,auth.userId);
  const exportRow=await db.query(`SELECT e.incident_id AS "incidentId",i.protocol
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
  const row=exportRow.rows[0] as {incidentId:string;protocol:string}|undefined;
  if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  const [retention,returns,timeline,audits,verifications]=await Promise.all([
   db.query(`SELECT retention_class AS "retentionClass",retain_until AS "retainUntil",legal_hold AS "legalHold",
      notes,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM sidec_artifact_retention WHERE export_id=$1 AND organization_id=$2`,[id,org]),
   db.query(`SELECT schema_version AS "schemaVersion",outcome,external_protocol AS "externalProtocol",
      received_at AS "receivedAt",source_name AS "sourceName",notes,payload_hash AS "payloadHash",created_at AS "createdAt"
      FROM sidec_return_records WHERE export_id=$1 AND organization_id=$2 ORDER BY created_at`,[id,org]),
   db.query(`SELECT event_type AS "eventType",note,metadata,occurred_at AS "occurredAt"
      FROM incident_timeline
      WHERE incident_id=$1 AND event_type LIKE 'sidec_%'
      ORDER BY occurred_at`,[row.incidentId]),
   db.query(`SELECT action,entity_type AS "entityType",entity_id AS "entityId",before_data AS "beforeData",
      after_data AS "afterData",metadata,occurred_at AS "occurredAt"
      FROM audit_logs
      WHERE (entity_id=$1 OR (entity_type LIKE 'sidec_%' AND (metadata->>'exportId'=$1 OR after_data->>'id'=$1)))
      ORDER BY occurred_at`,[id]),
   db.query(`SELECT proof_version AS "proofVersion",artifact_hash AS "artifactHash",manifest_hash AS "manifestHash",
      hmac_valid AS "hmacValid",asymmetric_valid AS "asymmetricValid",overall_valid AS "overallValid",
      verification_source AS "verificationSource",verified_at AS "verifiedAt"
      FROM sidec_integrity_verifications
      WHERE export_id=$1 AND organization_id=$2 ORDER BY verified_at`,[id,org])
  ]);
  const evidence={
   evidenceVersion:"sigdec-sidec-integrity-evidence/1.0",
   generatedAt:new Date().toISOString(),
   proof,
   retention:retention.rows[0]??null,
   returns:returns.rows,
   timeline:timeline.rows,
   audits:audits.rows,
   verifications:verifications.rows,
   archive:(await db.query(`SELECT r.bucket,r.object_key AS "objectKey",r.version_id AS "versionId",r.etag,
     r.object_lock_mode AS "objectLockMode",r.retain_until AS "retainUntil",r.legal_hold AS "legalHold",
     r.content_hash AS "contentHash",r.archived_at AS "archivedAt",
     COALESCE((SELECT json_agg(json_build_object(
       'existsRemote',v.exists_remote,'hashValid',v.hash_valid,'observedHash',v.observed_hash,
       'objectLockMode',v.object_lock_mode,'retainUntil',v.retain_until,'legalHold',v.legal_hold,
       'source',v.verification_source,'error',v.error_message,'verifiedAt',v.verified_at
     ) ORDER BY v.verified_at) FROM sidec_archive_verifications v WHERE v.export_id=r.export_id),'[]'::json) AS verifications
     FROM sidec_archive_receipts r WHERE r.export_id=$1 AND r.organization_id=$2`,[id,org])).rows[0]??null
  };
  const download=String((request.query as {download?:string})?.download??"").trim()==="1";
  if(download){
   const safeProtocol=row.protocol.replace(/[^A-Za-z0-9_-]/g,"_");
   reply.header("Content-Type","application/json; charset=utf-8");
   reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${proof.export.revision}-evidencias.json"`);
  }
  return evidence;
 });

 app.get("/api/v1/sidec-exports/:id/custody-pdf",{preHandler:requirePermission("sidec_custody.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const proof=await buildSidecIntegrityProof(org,id,auth.userId);
  const base=await db.query(`SELECT i.id AS "incidentId",i.protocol,o.name AS "organizationName"
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id JOIN organizations o ON o.id=e.organization_id
    WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
  const row=base.rows[0] as {incidentId:string;protocol:string;organizationName:string}|undefined;
  if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  const [timeline,audits,verifications]=await Promise.all([
   db.query(`SELECT occurred_at AS "occurredAt",event_type AS "eventType",COALESCE(note,'Evento SIDEC') AS description
     FROM incident_timeline WHERE incident_id=$1 AND event_type LIKE 'sidec_%' ORDER BY occurred_at`,[row.incidentId]),
   db.query(`SELECT occurred_at AS "occurredAt",action AS "eventType",
     COALESCE(action,'Auditoria SIDEC') || CASE WHEN entity_type IS NOT NULL THEN ' · '||entity_type ELSE '' END AS description
     FROM audit_logs WHERE entity_id=$1 OR metadata->>'exportId'=$1 ORDER BY occurred_at`,[id]),
   db.query(`SELECT verified_at AS "occurredAt",'integrity.'||verification_source AS "eventType",
     'Verificação de integridade: '||CASE WHEN overall_valid THEN 'válida' ELSE 'inválida' END AS description
     FROM sidec_integrity_verifications WHERE export_id=$1 AND organization_id=$2 ORDER BY verified_at`,[id,org])
  ]);
  const events=[...timeline.rows,...audits.rows,...verifications.rows]
   .map((x:any)=>({occurredAt:x.occurredAt,eventType:String(x.eventType),description:String(x.description)}) satisfies CustodyEvent)
   .sort((a,b)=>new Date(a.occurredAt).getTime()-new Date(b.occurredAt).getTime());
  const pdf=await buildSidecCustodyPdf({
   organizationName:row.organizationName,protocol:row.protocol,revision:proof.export.revision,
   proof,publicUrl:proof.publicVerificationUrl,events
  });
  const safe=row.protocol.replace(/[^A-Za-z0-9_-]/g,"_");
  return reply.type("application/pdf")
   .header("Content-Disposition",`attachment; filename="SIDEC-${safe}-R${proof.export.revision}-cadeia-custodia.pdf"`)
   .header("Content-Length",String(pdf.length))
   .send(pdf);
 });

 app.get("/api/v1/sidec-exports/:id/integrity-verifications",{preHandler:requirePermission("sidec_integrity.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const exists=await db.query(`SELECT 1 FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[id,org]);
  if(!exists.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT id,proof_version AS "proofVersion",artifact_hash AS "artifactHash",manifest_hash AS "manifestHash",
    hmac_valid AS "hmacValid",asymmetric_valid AS "asymmetricValid",overall_valid AS "overallValid",
    verification_source AS "verificationSource",verified_at AS "verifiedAt"
    FROM sidec_integrity_verifications
    WHERE export_id=$1 AND organization_id=$2
    ORDER BY verified_at DESC LIMIT 200`,[id,org]);
  return {items:r.rows};
 });

 app.post("/api/v1/sidec/verify-integrity-proof",async(request,reply)=>{
  const parsed=integrityProofSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_INTEGRITY_PROOF",details:parsed.error.flatten()});
  const proof=parsed.data;
  const asymmetricValid=verifySidecIntegrity({
   manifestHash:proof.manifest.sha256,
   artifactHash:proof.artifact.sha256,
   signature:proof.ed25519.signature,
   publicKey:proof.ed25519.publicKey,
   publicKeyFingerprint:proof.ed25519.publicKeyFingerprint
  });
  let hmacValid:boolean|null=null;
  try{hmacValid=verifySidecManifestSignature(proof.manifest.sha256,proof.hmac.signature,proof.hmac.keyId)}catch{hmacValid=null}
  const timestampValid=proof.proofVersion==="sigdec-sidec-integrity-proof/1.1"
   ? verifySidecTimestamp({
      manifestHash:proof.manifest.sha256,artifactHash:proof.artifact.sha256,attestationSignature:proof.ed25519.signature,
      timestampedAt:proof.timestamp.timestampedAt,statementHash:proof.timestamp.statementHash,
      signature:proof.timestamp.signature,publicKey:proof.timestamp.publicKey,publicKeyFingerprint:proof.timestamp.publicKeyFingerprint
     })
   : null;

  const registered=await db.query(`SELECT e.organization_id AS "organizationId"
    FROM sidec_exports e
    JOIN sidec_export_artifacts a ON a.export_id=e.id
    JOIN incidents i ON i.id=e.incident_id
    WHERE e.id=$1 AND a.content_hash=$2 AND a.manifest_hash=$3
      AND i.protocol=$4 AND e.revision=$5 AND e.schema_version=$6`,
   [proof.export.id,proof.artifact.sha256,proof.manifest.sha256,proof.export.protocol,proof.export.revision,proof.export.schemaVersion]);
  const organizationIdValue=registered.rows[0]?.organizationId??null;
  const overallValid=asymmetricValid&&(timestampValid===null||timestampValid);
  await db.query(`INSERT INTO sidec_integrity_verifications(
    export_id,organization_id,proof_version,artifact_hash,manifest_hash,hmac_valid,asymmetric_valid,overall_valid,
    verification_source,ip,user_agent
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'EXTERNAL',$9,$10)`,
   [organizationIdValue?proof.export.id:null,organizationIdValue,proof.proofVersion,proof.artifact.sha256,proof.manifest.sha256,
    hmacValid,asymmetricValid,overallValid,request.ip,request.headers["user-agent"]??null]);
  return {
   valid:overallValid,
   asymmetricValid,
   timestampValid,
   hmacValid,
   registeredArtifact:Boolean(organizationIdValue),
   proofVersion:proof.proofVersion,
   publicKeyFingerprint:proof.ed25519.publicKeyFingerprint
  };
 });

 app.get("/api/v1/public/sidec-integrity/:artifactHash",async(request,reply)=>{
  const {artifactHash}=request.params as {artifactHash:string};
  if(!/^[a-f0-9]{64}$/.test(artifactHash))return reply.code(400).send({error:"INVALID_ARTIFACT_HASH"});
  const r=await db.query(`SELECT e.id AS "exportId",e.revision,e.schema_version AS "schemaVersion",i.protocol,
    a.content_hash AS "artifactHash",a.manifest_hash AS "manifestHash",a.signed_at AS "sealedAt",
    t.key_id AS "ed25519KeyId",t.signature AS "ed25519Signature",t.public_key AS "ed25519PublicKey",
    t.public_key_fingerprint AS "ed25519Fingerprint",t.attested_at AS "attestedAt",
    ts.statement_hash AS "statementHash",ts.timestamped_at AS "timestampedAt",ts.key_id AS "timestampKeyId",
    ts.signature AS "timestampSignature",ts.public_key AS "timestampPublicKey",ts.public_key_fingerprint AS "timestampFingerprint",
    (wr.export_id IS NOT NULL) AS "archiveCreated",wr.object_lock_mode AS "archiveLockMode",
    wr.retain_until AS "archiveRetainUntil",wr.legal_hold AS "archiveLegalHold",wr.archived_at AS "archivedAt",
    wv.exists_remote AS "archiveExistsRemote",wv.hash_valid AS "archiveHashValid",wv.verified_at AS "archiveVerifiedAt"
   FROM sidec_export_artifacts a
   JOIN sidec_exports e ON e.id=a.export_id
   JOIN incidents i ON i.id=e.incident_id
   LEFT JOIN sidec_artifact_attestations t ON t.export_id=a.export_id
   LEFT JOIN sidec_integrity_timestamps ts ON ts.export_id=a.export_id
   LEFT JOIN sidec_archive_receipts wr ON wr.export_id=a.export_id
   LEFT JOIN LATERAL (
    SELECT exists_remote,hash_valid,verified_at FROM sidec_archive_verifications av
    WHERE av.export_id=a.export_id ORDER BY verified_at DESC LIMIT 1
   ) wv ON true
   WHERE a.content_hash=$1 LIMIT 1`,[artifactHash]);
  const row=r.rows[0] as any;
  if(!row||!row.ed25519Signature)return reply.code(404).send({error:"PUBLIC_INTEGRITY_NOT_AVAILABLE"});
  if(!row.timestampSignature){
   const exportOrg=await db.query(`SELECT organization_id AS "organizationId" FROM sidec_exports WHERE id=$1`,[row.exportId]);
   const org=exportOrg.rows[0]?.organizationId;
   if(org)await ensureSidecIntegrityTimestamp(String(org),String(row.exportId),null);
   const retry=await db.query(`SELECT statement_hash AS "statementHash",timestamped_at AS "timestampedAt",key_id AS "timestampKeyId",
     signature AS "timestampSignature",public_key AS "timestampPublicKey",public_key_fingerprint AS "timestampFingerprint"
     FROM sidec_integrity_timestamps WHERE export_id=$1`,[row.exportId]);
   Object.assign(row,retry.rows[0]??{});
  }
  const asymmetricValid=verifySidecIntegrity({
   manifestHash:row.manifestHash,artifactHash:row.artifactHash,signature:row.ed25519Signature,
   publicKey:row.ed25519PublicKey,publicKeyFingerprint:row.ed25519Fingerprint
  });
  const timestampValid=Boolean(row.timestampSignature)&&verifySidecTimestamp({
   manifestHash:row.manifestHash,artifactHash:row.artifactHash,attestationSignature:row.ed25519Signature,
   timestampedAt:new Date(row.timestampedAt).toISOString(),statementHash:row.statementHash,
   signature:row.timestampSignature,publicKey:row.timestampPublicKey,publicKeyFingerprint:row.timestampFingerprint
  });
  const valid=asymmetricValid&&timestampValid;
  await db.query(`INSERT INTO sidec_integrity_verifications(
    export_id,organization_id,proof_version,artifact_hash,manifest_hash,hmac_valid,asymmetric_valid,overall_valid,
    verification_source,ip,user_agent
   ) SELECT e.id,e.organization_id,'sigdec-sidec-integrity-proof/1.1',$1,$2,NULL,$3,$4,'EXTERNAL',$5,$6
     FROM sidec_exports e WHERE e.id=$7`,
   [row.artifactHash,row.manifestHash,asymmetricValid,valid,request.ip,request.headers["user-agent"]??null,row.exportId]);
  return {
   valid,artifactHash:row.artifactHash,manifestHash:row.manifestHash,
   protocol:row.protocol,revision:Number(row.revision),schemaVersion:row.schemaVersion,sealedAt:row.sealedAt,
   ed25519:{keyId:row.ed25519KeyId,publicKeyFingerprint:row.ed25519Fingerprint,attestedAt:row.attestedAt,valid:asymmetricValid},
   timestamp:{keyId:row.timestampKeyId,statementHash:row.statementHash,timestampedAt:row.timestampedAt,publicKeyFingerprint:row.timestampFingerprint,valid:timestampValid},
   archive:row.archiveCreated?{
    preserved:true,lockMode:row.archiveLockMode,retainUntil:row.archiveRetainUntil,legalHold:Boolean(row.archiveLegalHold),
    archivedAt:row.archivedAt,existsRemote:row.archiveExistsRemote,hashValid:row.archiveHashValid,verifiedAt:row.archiveVerifiedAt
   }:{preserved:false}
  };
 });

 app.get("/api/v1/sidec-exports/:id/download",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const format=String((request.query as {format?:string})?.format??"json").toLowerCase();
  const r=await db.query(`SELECT e.revision,e.schema_version AS "schemaVersion",e.snapshot,e.snapshot_hash AS "snapshotHash",
      e.manifest_hash AS "manifestHash",e.status,i.protocol
    FROM sidec_exports e JOIN incidents i ON i.id=e.incident_id
    WHERE e.id=$1 AND e.organization_id=$2`,[id,org]);
  const item=r.rows[0] as SidecZipSource|undefined;
  if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  const safeProtocol=item.protocol.replace(/[^A-Za-z0-9_-]/g,"_");

  if(format==="csv"){
   reply.header("Content-Type","text/csv; charset=utf-8");
   reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.csv"`);
   return "\uFEFF"+sidecPackageSummaryCsv(item.snapshot);
  }

  if(format==="zip"){
   let artifactResult=await db.query(`SELECT file_name AS "fileName",byte_size AS "byteSize",content_hash AS "contentHash",
     content,manifest_hash AS "manifestHash",signature_algorithm AS "signatureAlgorithm",
     manifest_signature AS "manifestSignature",signing_key_id AS "signingKeyId",signed_at AS "signedAt"
     FROM sidec_export_artifacts WHERE export_id=$1 AND organization_id=$2`,[id,org]);

   if(!artifactResult.rows[0]&&item.status&&item.status!=="READY"&&item.status!=="CANCELLED"){
    await sealSidecExportArtifact(org,id,auth.userId);
    artifactResult=await db.query(`SELECT file_name AS "fileName",byte_size AS "byteSize",content_hash AS "contentHash",
      content,manifest_hash AS "manifestHash",signature_algorithm AS "signatureAlgorithm",
      manifest_signature AS "manifestSignature",signing_key_id AS "signingKeyId",signed_at AS "signedAt"
      FROM sidec_export_artifacts WHERE export_id=$1 AND organization_id=$2`,[id,org]);
   }

   const artifact=artifactResult.rows[0] as {fileName:string;byteSize:number;contentHash:string;content:Buffer;manifestHash:string;signatureAlgorithm:string;manifestSignature:string;signingKeyId:string;signedAt:string}|undefined;
   if(artifact){
    const computedZipHash=hashBinary(artifact.content);
    if(computedZipHash!==artifact.contentHash)return reply.code(409).send({error:"SEALED_ZIP_INTEGRITY_ERROR",expected:artifact.contentHash,computed:computedZipHash});
    const hmacValid=verifySidecManifestSignature(artifact.manifestHash,artifact.manifestSignature,artifact.signingKeyId);
    if(!hmacValid)return reply.code(409).send({error:"MANIFEST_SIGNATURE_INVALID"});
    const attestation=await ensureSidecArtifactAttestation(org,id,auth.userId) as any;
    const asymmetricValid=verifySidecIntegrity({
     manifestHash:artifact.manifestHash,artifactHash:artifact.contentHash,
     signature:attestation.signature,publicKey:attestation.publicKey,publicKeyFingerprint:attestation.publicKeyFingerprint
    });
    if(!asymmetricValid)return reply.code(409).send({error:"ED25519_ATTESTATION_INVALID"});
    await db.query(`INSERT INTO sidec_integrity_verifications(
      export_id,organization_id,proof_version,artifact_hash,manifest_hash,hmac_valid,asymmetric_valid,overall_valid,
      verification_source,ip,user_agent
     ) VALUES($1,$2,'sigdec-sidec-integrity-proof/1.0',$3,$4,true,true,true,'INTERNAL',$5,$6)`,
     [id,org,artifact.contentHash,artifact.manifestHash,request.ip,request.headers["user-agent"]??null]);
    return reply.type("application/zip")
     .header("Content-Disposition",`attachment; filename="${artifact.fileName}"`)
     .header("Content-Length",String(artifact.content.length))
     .header("X-SIGDEC-Artifact-Mode","sealed")
     .header("X-SIGDEC-Content-SHA256",artifact.contentHash)
     .header("X-SIGDEC-Manifest-SHA256",artifact.manifestHash)
     .header("X-SIGDEC-Manifest-Signature",artifact.manifestSignature)
     .header("X-SIGDEC-Signing-Key-Id",artifact.signingKeyId)
     .header("X-SIGDEC-Ed25519-Key-Id",attestation.keyId)
     .header("X-SIGDEC-Ed25519-Fingerprint",attestation.publicKeyFingerprint)
     .header("X-SIGDEC-Ed25519-Signature",attestation.signature)
     .send(artifact.content);
   }

   const preview=await buildSidecZip(org,id,item);
   return reply.type("application/zip")
    .header("Content-Disposition",`attachment; filename="PREVIEW-${preview.fileName}"`)
    .header("Content-Length",String(preview.zip.length))
    .header("X-SIGDEC-Artifact-Mode","preview")
    .header("X-SIGDEC-Content-SHA256",hashBinary(preview.zip))
    .header("X-SIGDEC-Manifest-SHA256",preview.manifestHash)
    .send(preview.zip);
  }

  if(format!=="json")return reply.code(400).send({error:"UNSUPPORTED_FORMAT"});
  reply.header("Content-Type","application/json; charset=utf-8");
  reply.header("Content-Disposition",`attachment; filename="SIDEC-${safeProtocol}-R${item.revision}.json"`);
  return JSON.stringify({snapshotHash:item.snapshotHash,manifestHash:item.manifestHash??null,...item.snapshot},null,2);
 });

 app.get("/api/v1/sidec-exports/:id/returns",{preHandler:requirePermission("sidec_exports.read")},async(request,reply)=>{
  const org=organizationId(authFrom(request).organizationId),{id}=request.params as {id:string};
  const exists=await db.query(`SELECT 1 FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[id,org]);
  if(!exists.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`SELECT id,schema_version AS "schemaVersion",outcome,external_protocol AS "externalProtocol",
    received_at AS "receivedAt",source_name AS "sourceName",notes,payload_hash AS "payloadHash",created_at AS "createdAt"
    FROM sidec_return_records WHERE export_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[id,org]);
  return {items:r.rows};
 });

 app.post("/api/v1/sidec-exports/:id/returns/import",{preHandler:requirePermission("sidec_returns.manage")},async(request,reply)=>{
  const auth=authFrom(request),org=organizationId(auth.organizationId),{id}=request.params as {id:string};
  const parsed=returnEnvelopeSchema.safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_RETURN_ENVELOPE",details:parsed.error.flatten()});
  const currentResult=await db.query(`SELECT id,incident_id AS "incidentId",revision,status,external_protocol AS "externalProtocol"
    FROM sidec_exports WHERE id=$1 AND organization_id=$2`,[id,org]);
  const current=currentResult.rows[0] as {incidentId:string;revision:number;status:string;externalProtocol?:string|null}|undefined;
  if(!current)return reply.code(404).send({error:"NOT_FOUND"});
  if(current.status!=="SUBMITTED")return reply.code(409).send({error:"RETURN_NOT_ALLOWED",status:current.status});
  if(current.externalProtocol&&parsed.data.externalProtocol!==current.externalProtocol){
   return reply.code(409).send({error:"EXTERNAL_PROTOCOL_MISMATCH",expected:current.externalProtocol,received:parsed.data.externalProtocol});
  }

  const normalizedPayload={
   schemaVersion:parsed.data.schemaVersion,
   externalProtocol:parsed.data.externalProtocol,
   outcome:parsed.data.outcome,
   receivedAt:parsed.data.receivedAt.toISOString(),
   sourceName:parsed.data.sourceName??null,
   notes:parsed.data.notes??null
  };
  const payloadHash=hashSidecPackage(normalizedPayload);
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const inserted=await client.query<{id:string}>(`INSERT INTO sidec_return_records(
     export_id,organization_id,schema_version,outcome,external_protocol,received_at,source_name,notes,payload,payload_hash,imported_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
    ON CONFLICT(export_id,payload_hash) DO NOTHING RETURNING id`,
    [id,org,parsed.data.schemaVersion,parsed.data.outcome,parsed.data.externalProtocol,parsed.data.receivedAt,
     parsed.data.sourceName??null,parsed.data.notes??null,JSON.stringify(normalizedPayload),payloadHash,auth.userId]);
   if(!inserted.rows[0]){
    const existing=await client.query(`SELECT id FROM sidec_return_records WHERE export_id=$1 AND payload_hash=$2`,[id,payloadHash]);
    await client.query("ROLLBACK");
    return reply.send({imported:false,id:existing.rows[0]?.id??null,payloadHash});
   }
   const outcome=parsed.data.outcome;
   const updated=await client.query(`UPDATE sidec_exports SET status=$1,
     external_notes=COALESCE($2,external_notes),
     acknowledged_at=CASE WHEN $1='ACKNOWLEDGED' THEN $3 ELSE acknowledged_at END,
     rejected_at=CASE WHEN $1='REJECTED' THEN $3 ELSE rejected_at END,
     updated_at=now()
     WHERE id=$4 AND organization_id=$5
     RETURNING id,status,external_protocol AS "externalProtocol",updated_at AS "updatedAt"`,
    [outcome,parsed.data.notes??null,parsed.data.receivedAt,id,org]);
   await client.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata)
     VALUES($1,'sidec_return.imported',$2,$3,$4::jsonb)`,
    [current.incidentId,auth.userId,`Retorno estruturado SIDEC importado para a revisão ${current.revision}: ${outcome}.`,
     JSON.stringify({exportId:id,payloadHash,sourceName:parsed.data.sourceName??null,externalProtocol:parsed.data.externalProtocol})]);
   await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data,metadata)
     VALUES($1,'sidec_return.import','sidec_export',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
    [auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(currentResult.rows[0]),JSON.stringify(updated.rows[0]),
     JSON.stringify({returnId:inserted.rows[0].id,payloadHash,schemaVersion:parsed.data.schemaVersion})]);
   await client.query("COMMIT");
   return reply.code(201).send({imported:true,id:inserted.rows[0].id,payloadHash,export:updated.rows[0]});
  }catch(error){
   await client.query("ROLLBACK");throw error;
  }finally{client.release();}
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
  const sealedArtifact=next==="EXPORTED"?await sealSidecExportArtifact(org,id,auth.userId):null;
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
    VALUES($1,'sidec_export.status_changed',$2,$3,$4::jsonb)`,[current.incidentId,auth.userId,`Pacote SIDEC revisão ${current.revision}: ${current.status} → ${next}.`,JSON.stringify({exportId:id,externalProtocol:parsed.data.externalProtocol??current.externalProtocol??null,artifactHash:sealedArtifact?.contentHash??null,manifestSignature:sealedArtifact?.manifestSignature??null})]);
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
    VALUES($1,'sidec_export.status','sidec_export',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
  return {...r.rows[0],artifact:sealedArtifact??undefined};
 });
}
