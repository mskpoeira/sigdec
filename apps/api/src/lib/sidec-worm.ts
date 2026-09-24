import { createHash } from "node:crypto";
import {
 GetObjectCommand,GetObjectLegalHoldCommand,GetObjectRetentionCommand,PutObjectCommand,
 PutObjectLegalHoldCommand,PutObjectRetentionCommand,S3Client,type ObjectLockMode
} from "@aws-sdk/client-s3";

export type WormRetention={retainUntil?:Date|null;legalHold:boolean};
type WormDestination="PRIMARY"|"REPLICA";

function required(name:string){
 const value=process.env[name]?.trim();
 if(!value)throw Object.assign(new Error(`Variável ${name} não configurada para arquivo WORM.`),{code:"WORM_NOT_CONFIGURED"});
 return value;
}

function boolEnv(name:string,defaultValue=false){
 const raw=process.env[name]?.trim().toLowerCase();
 if(!raw)return defaultValue;
 return ["1","true","yes","on"].includes(raw);
}

export function wormBucket(){
 return process.env.SIDEC_WORM_BUCKET?.trim()||`${required("S3_BUCKET")}-worm`;
}

export function wormMode():ObjectLockMode{
 const value=(process.env.SIDEC_WORM_MODE?.trim().toUpperCase()||"GOVERNANCE") as ObjectLockMode;
 if(value!=="GOVERNANCE"&&value!=="COMPLIANCE")throw new Error("SIDEC_WORM_MODE deve ser GOVERNANCE ou COMPLIANCE.");
 return value;
}

export function wormReplicaEnabled(){return boolEnv("SIDEC_WORM_REPLICA_ENABLED",false)}

export function wormReplicaBucket(){
 return process.env.SIDEC_WORM_REPLICA_BUCKET?.trim()||"sigdec-worm-replica-v1";
}

export function wormReplicaMode():ObjectLockMode{
 const value=(process.env.SIDEC_WORM_REPLICA_MODE?.trim().toUpperCase()||String(wormMode())) as ObjectLockMode;
 if(value!=="GOVERNANCE"&&value!=="COMPLIANCE")throw new Error("SIDEC_WORM_REPLICA_MODE deve ser GOVERNANCE ou COMPLIANCE.");
 return value;
}

export function wormObjectKey(artifactHash:string){
 if(!/^[a-f0-9]{64}$/.test(artifactHash))throw new Error("Hash de artefato inválido para chave WORM.");
 return `sidec/${artifactHash.slice(0,2)}/${artifactHash}.zip`;
}

function destinationConfig(destination:WormDestination){
 if(destination==="PRIMARY"){
  return {
   endpoint:required("S3_ENDPOINT"),
   region:process.env.S3_REGION?.trim()||"us-east-1",
   accessKeyId:required("S3_ACCESS_KEY"),
   secretAccessKey:required("S3_SECRET_KEY"),
   bucket:wormBucket(),
   mode:wormMode()
  };
 }
 if(!wormReplicaEnabled())throw Object.assign(new Error("Réplica WORM secundária não habilitada."),{code:"WORM_REPLICA_DISABLED"});
 return {
  endpoint:process.env.SIDEC_WORM_REPLICA_ENDPOINT?.trim()||required("S3_ENDPOINT"),
  region:process.env.SIDEC_WORM_REPLICA_REGION?.trim()||process.env.S3_REGION?.trim()||"us-east-1",
  accessKeyId:process.env.SIDEC_WORM_REPLICA_ACCESS_KEY?.trim()||required("S3_ACCESS_KEY"),
  secretAccessKey:process.env.SIDEC_WORM_REPLICA_SECRET_KEY?.trim()||required("S3_SECRET_KEY"),
  bucket:wormReplicaBucket(),
  mode:wormReplicaMode()
 };
}

function client(destination:WormDestination){
 const config=destinationConfig(destination);
 return new S3Client({
  region:config.region,endpoint:config.endpoint,forcePathStyle:true,
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey}
 });
}

async function archiveAt(destination:WormDestination,input:{
 content:Buffer;artifactHash:string;manifestHash:string;fileName:string;retention:WormRetention;
}){
 const observed=createHash("sha256").update(input.content).digest("hex");
 if(observed!==input.artifactHash)throw Object.assign(new Error("Hash do artefato local divergente antes do arquivo WORM."),{code:"WORM_LOCAL_HASH_MISMATCH"});
 if(!input.retention.retainUntil&&!input.retention.legalHold){
  throw Object.assign(new Error("Defina retainUntil ou legal hold antes do arquivamento WORM."),{code:"WORM_RETENTION_REQUIRED"});
 }
 const config=destinationConfig(destination),key=wormObjectKey(input.artifactHash);
 const retainUntil=input.retention.retainUntil??undefined;
 const mode=retainUntil?config.mode:undefined;
 const result=await client(destination).send(new PutObjectCommand({
  Bucket:config.bucket,Key:key,Body:input.content,ContentType:"application/zip",ContentLength:input.content.length,
  Metadata:{
   "sigdec-sha256":input.artifactHash,
   "sigdec-manifest-sha256":input.manifestHash,
   "sigdec-file-name":Buffer.from(input.fileName,"utf8").toString("base64url"),
   "sigdec-destination":destination.toLowerCase()
  },
  ObjectLockMode:mode,ObjectLockRetainUntilDate:retainUntil,
  ObjectLockLegalHoldStatus:input.retention.legalHold?"ON":undefined
 }));
 return {
  destination,bucket:config.bucket,key,versionId:result.VersionId??null,etag:result.ETag??null,
  storageClass:"STANDARD",objectLockMode:mode??null,retainUntil:retainUntil??null,legalHold:input.retention.legalHold
 };
}

export function archiveSidecArtifact(input:{content:Buffer;artifactHash:string;manifestHash:string;fileName:string;retention:WormRetention}){
 return archiveAt("PRIMARY",input);
}
export function archiveSidecReplica(input:{content:Buffer;artifactHash:string;manifestHash:string;fileName:string;retention:WormRetention}){
 return archiveAt("REPLICA",input);
}

async function extendRetentionAt(destination:WormDestination,input:{
 bucket:string;key:string;versionId?:string|null;mode:ObjectLockMode;retainUntil:Date;
}){
 await client(destination).send(new PutObjectRetentionCommand({
  Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined,
  Retention:{Mode:input.mode,RetainUntilDate:input.retainUntil}
 }));
 return {mode:input.mode,retainUntil:input.retainUntil};
}

export function extendSidecArchiveRetention(input:{bucket:string;key:string;versionId?:string|null;mode:ObjectLockMode;retainUntil:Date}){
 return extendRetentionAt("PRIMARY",input);
}
export function extendSidecReplicaRetention(input:{bucket:string;key:string;versionId?:string|null;mode:ObjectLockMode;retainUntil:Date}){
 return extendRetentionAt("REPLICA",input);
}

async function enableLegalHoldAt(destination:WormDestination,input:{bucket:string;key:string;versionId?:string|null}){
 await client(destination).send(new PutObjectLegalHoldCommand({
  Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined,LegalHold:{Status:"ON"}
 }));
 return {legalHold:true};
}

export function enableSidecArchiveLegalHold(input:{bucket:string;key:string;versionId?:string|null}){
 return enableLegalHoldAt("PRIMARY",input);
}
export function enableSidecReplicaLegalHold(input:{bucket:string;key:string;versionId?:string|null}){
 return enableLegalHoldAt("REPLICA",input);
}

async function verifyAt(destination:WormDestination,input:{bucket:string;key:string;versionId?:string|null;expectedHash:string}){
 try{
  const s3=client(destination);
  const result=await s3.send(new GetObjectCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined}));
  if(!result.Body)throw new Error("Objeto WORM sem corpo.");
  const bytes=Buffer.from(await result.Body.transformToByteArray());
  const observedHash=createHash("sha256").update(bytes).digest("hex");
  const [retentionResult,holdResult]=await Promise.all([
   s3.send(new GetObjectRetentionCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined})).catch(()=>null),
   s3.send(new GetObjectLegalHoldCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined})).catch(()=>null)
  ]);
  return {
   destination,existsRemote:true,observedHash,hashValid:observedHash===input.expectedHash,
   objectLockMode:retentionResult?.Retention?.Mode??result.ObjectLockMode??null,
   retainUntil:retentionResult?.Retention?.RetainUntilDate??result.ObjectLockRetainUntilDate??null,
   legalHold:(holdResult?.LegalHold?.Status??result.ObjectLockLegalHoldStatus)==="ON",
   versionId:result.VersionId??input.versionId??null,errorMessage:null as string|null
  };
 }catch(error){
  return {
   destination,existsRemote:false,observedHash:null,hashValid:null,objectLockMode:null,retainUntil:null,legalHold:null,
   versionId:input.versionId??null,errorMessage:error instanceof Error?error.message:String(error)
  };
 }
}

export function verifySidecArchive(input:{bucket:string;key:string;versionId?:string|null;expectedHash:string}){
 return verifyAt("PRIMARY",input);
}
export function verifySidecReplica(input:{bucket:string;key:string;versionId?:string|null;expectedHash:string}){
 return verifyAt("REPLICA",input);
}


async function restoreAt(destination:WormDestination,input:{bucket:string;key:string;versionId?:string|null}){
 const result=await client(destination).send(new GetObjectCommand({
  Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined
 }));
 if(!result.Body)throw new Error("Objeto WORM sem corpo para restauração.");
 const bytes=Buffer.from(await result.Body.transformToByteArray());
 return {
  destination,
  bytes,
  versionId:result.VersionId??input.versionId??null,
  contentLength:bytes.length,
  etag:result.ETag??null,
  lastModified:result.LastModified??null
 };
}

export function restoreSidecArchiveObject(input:{bucket:string;key:string;versionId?:string|null}){
 return restoreAt("PRIMARY",input);
}

export function restoreSidecReplicaObject(input:{bucket:string;key:string;versionId?:string|null}){
 return restoreAt("REPLICA",input);
}
