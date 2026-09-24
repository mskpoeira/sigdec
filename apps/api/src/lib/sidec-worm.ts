import { createHash } from "node:crypto";
import { GetObjectCommand,GetObjectLegalHoldCommand,GetObjectRetentionCommand,PutObjectCommand,PutObjectLegalHoldCommand,PutObjectRetentionCommand,S3Client,type ObjectLockMode } from "@aws-sdk/client-s3";

export type WormRetention={
 retainUntil?:Date|null;
 legalHold:boolean;
};

function required(name:string){
 const value=process.env[name]?.trim();
 if(!value)throw Object.assign(new Error(`Variável ${name} não configurada para arquivo WORM.`),{code:"WORM_NOT_CONFIGURED"});
 return value;
}

export function wormBucket(){
 return process.env.SIDEC_WORM_BUCKET?.trim()||`${required("S3_BUCKET")}-worm`;
}

export function wormMode():ObjectLockMode{
 const value=(process.env.SIDEC_WORM_MODE?.trim().toUpperCase()||"GOVERNANCE") as ObjectLockMode;
 if(value!=="GOVERNANCE"&&value!=="COMPLIANCE")throw new Error("SIDEC_WORM_MODE deve ser GOVERNANCE ou COMPLIANCE.");
 return value;
}

export function wormObjectKey(artifactHash:string){
 if(!/^[a-f0-9]{64}$/.test(artifactHash))throw new Error("Hash de artefato inválido para chave WORM.");
 return `sidec/${artifactHash.slice(0,2)}/${artifactHash}.zip`;
}

function client(){
 return new S3Client({
  region:process.env.S3_REGION?.trim()||"us-east-1",
  endpoint:required("S3_ENDPOINT"),
  forcePathStyle:true,
  credentials:{
   accessKeyId:required("S3_ACCESS_KEY"),
   secretAccessKey:required("S3_SECRET_KEY")
  }
 });
}

export async function archiveSidecArtifact(input:{
 content:Buffer;
 artifactHash:string;
 manifestHash:string;
 fileName:string;
 retention:WormRetention;
}){
 const observed=createHash("sha256").update(input.content).digest("hex");
 if(observed!==input.artifactHash)throw Object.assign(new Error("Hash do artefato local divergente antes do arquivo WORM."),{code:"WORM_LOCAL_HASH_MISMATCH"});
 if(!input.retention.retainUntil&&!input.retention.legalHold){
  throw Object.assign(new Error("Defina retainUntil ou legal hold antes do arquivamento WORM."),{code:"WORM_RETENTION_REQUIRED"});
 }
 const bucket=wormBucket(),key=wormObjectKey(input.artifactHash);
 const retainUntil=input.retention.retainUntil??undefined;
 const mode=retainUntil?wormMode():undefined;
 const result=await client().send(new PutObjectCommand({
  Bucket:bucket,
  Key:key,
  Body:input.content,
  ContentType:"application/zip",
  ContentLength:input.content.length,
  Metadata:{
   "sigdec-sha256":input.artifactHash,
   "sigdec-manifest-sha256":input.manifestHash,
   "sigdec-file-name":Buffer.from(input.fileName,"utf8").toString("base64url")
  },
  ObjectLockMode:mode,
  ObjectLockRetainUntilDate:retainUntil,
  ObjectLockLegalHoldStatus:input.retention.legalHold?"ON":undefined
 }));
 return {
  bucket,key,
  versionId:result.VersionId??null,
  etag:result.ETag??null,
  storageClass:"STANDARD",
  objectLockMode:mode??null,
  retainUntil:retainUntil??null,
  legalHold:input.retention.legalHold
 };
}

export async function extendSidecArchiveRetention(input:{
 bucket:string;key:string;versionId?:string|null;mode:ObjectLockMode;retainUntil:Date;
}){
 await client().send(new PutObjectRetentionCommand({
  Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined,
  Retention:{Mode:input.mode,RetainUntilDate:input.retainUntil}
 }));
 return {mode:input.mode,retainUntil:input.retainUntil};
}

export async function enableSidecArchiveLegalHold(input:{bucket:string;key:string;versionId?:string|null}){
 await client().send(new PutObjectLegalHoldCommand({
  Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined,
  LegalHold:{Status:"ON"}
 }));
 return {legalHold:true};
}

export async function verifySidecArchive(input:{bucket:string;key:string;versionId?:string|null;expectedHash:string}){
 try{
  const s3=client();
  const result=await s3.send(new GetObjectCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined}));
  if(!result.Body)throw new Error("Objeto WORM sem corpo.");
  const bytes=Buffer.from(await result.Body.transformToByteArray());
  const observedHash=createHash("sha256").update(bytes).digest("hex");
  const [retentionResult,holdResult]=await Promise.all([
   s3.send(new GetObjectRetentionCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined})).catch(()=>null),
   s3.send(new GetObjectLegalHoldCommand({Bucket:input.bucket,Key:input.key,VersionId:input.versionId??undefined})).catch(()=>null)
  ]);
  return {
   existsRemote:true,
   observedHash,
   hashValid:observedHash===input.expectedHash,
   objectLockMode:retentionResult?.Retention?.Mode??result.ObjectLockMode??null,
   retainUntil:retentionResult?.Retention?.RetainUntilDate??result.ObjectLockRetainUntilDate??null,
   legalHold:(holdResult?.LegalHold?.Status??result.ObjectLockLegalHoldStatus)==="ON",
   versionId:result.VersionId??input.versionId??null,
   errorMessage:null as string|null
  };
 }catch(error){
  return {
   existsRemote:false,
   observedHash:null,
   hashValid:null,
   objectLockMode:null,
   retainUntil:null,
   legalHold:null,
   versionId:input.versionId??null,
   errorMessage:error instanceof Error?error.message:String(error)
  };
 }
}
