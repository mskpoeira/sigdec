import { createHash,createPrivateKey,createPublicKey,sign,verify } from "node:crypto";

const proofDomain="SIGDEC/SIDEC/INTEGRITY/ED25519/v1";
const timestampDomain="SIGDEC/SIDEC/TIMESTAMP/ED25519/v1";
const continuityChangeReportDomain="SIGDEC/SIDEC/CONTINUITY-CHANGE-REPORT/ED25519/v1";
const auditCheckpointDomain="SIGDEC/AUDIT/CHECKPOINT/ED25519/v1";
const pkcs8Prefix=Buffer.from("302e020100300506032b657004220420","hex");

function baseSecret(){
 const secret=process.env.SIDEC_ED25519_PRIVATE_SEED_BASE64?.trim();
 if(secret){
  const seed=Buffer.from(secret,"base64");
  if(seed.length!==32)throw new Error("SIDEC_ED25519_PRIVATE_SEED_BASE64 deve decodificar exatamente 32 bytes.");
  return seed;
 }
 const fallback=process.env.SIDEC_MANIFEST_SIGNING_SECRET??process.env.JWT_SECRET;
 if(!fallback||fallback.length<32)throw new Error("Configure SIDEC_ED25519_PRIVATE_SEED_BASE64 ou um segredo SIGDEC de pelo menos 32 caracteres.");
 return createHash("sha256").update("SIGDEC/SIDEC/ED25519/DERIVED-SEED/v1","utf8").update(fallback,"utf8").digest();
}

export function currentSidecEd25519KeyId(){
 return process.env.SIDEC_ED25519_KEY_ID?.trim()||"derived-v1";
}

function privateKey(){
 return createPrivateKey({key:Buffer.concat([pkcs8Prefix,baseSecret()]),format:"der",type:"pkcs8"});
}

function integrityPayload(manifestHash:string,artifactHash:string){
 return Buffer.from(`${proofDomain}\nmanifest=${manifestHash}\nartifact=${artifactHash}\n`,"utf8");
}

function timestampPayload(manifestHash:string,artifactHash:string,attestationSignature:string,timestampedAt:string){
 return Buffer.from(`${timestampDomain}\nmanifest=${manifestHash}\nartifact=${artifactHash}\nattestation=${attestationSignature}\ntimestamp=${timestampedAt}\n`,"utf8");
}

function continuityChangeReportPayload(input:{reportHash:string;proposalId:string;targetPlanId:string;sealedAt:string}){
 return Buffer.from(
  `${continuityChangeReportDomain}\nproposal=${input.proposalId}\ntargetPlan=${input.targetPlanId}\nreport=${input.reportHash}\nsealedAt=${input.sealedAt}\n`,
  "utf8"
 );
}

export type AuditCheckpointSignatureInput={
 checkpointHash:string;
 auditRootHash:string;
 previousCheckpointHash:string|null;
 organizationId:string;
 createdAt:string;
 auditCount:number;
 firstAuditId:string|null;
 lastAuditId:string|null;
 integrityVersion:number;
};

function auditCheckpointPayload(input:AuditCheckpointSignatureInput){
 return Buffer.from(
  `${auditCheckpointDomain}\ncheckpoint=${input.checkpointHash}\nroot=${input.auditRootHash}\nprevious=${input.previousCheckpointHash??"GENESIS"}\norganization=${input.organizationId}\ncreatedAt=${input.createdAt}\nauditCount=${input.auditCount}\nfirstAuditId=${input.firstAuditId??""}\nlastAuditId=${input.lastAuditId??""}\nintegrityVersion=${input.integrityVersion}\n`,
  "utf8"
 );
}

export function signSidecIntegrity(manifestHash:string,artifactHash:string){
 const key=privateKey();
 const publicKey=createPublicKey(key);
 const publicDer=publicKey.export({format:"der",type:"spki"}) as Buffer;
 return {
  algorithm:"Ed25519" as const,
  keyId:currentSidecEd25519KeyId(),
  signature:sign(null,integrityPayload(manifestHash,artifactHash),key).toString("base64"),
  publicKey:publicKey.export({format:"pem",type:"spki"}).toString(),
  publicKeyFingerprint:createHash("sha256").update(publicDer).digest("hex")
 };
}

export function fingerprintSidecPublicKey(publicKeyPem:string){
 const key=createPublicKey(publicKeyPem);
 const der=key.export({format:"der",type:"spki"}) as Buffer;
 return createHash("sha256").update(der).digest("hex");
}

export function verifySidecIntegrity(input:{
 manifestHash:string;
 artifactHash:string;
 signature:string;
 publicKey:string;
 publicKeyFingerprint:string;
}){
 try{
  const fingerprint=fingerprintSidecPublicKey(input.publicKey);
  if(fingerprint!==input.publicKeyFingerprint)return false;
  return verify(
   null,
   integrityPayload(input.manifestHash,input.artifactHash),
   createPublicKey(input.publicKey),
   Buffer.from(input.signature,"base64")
  );
 }catch{
  return false;
 }
}


export function signSidecTimestamp(input:{manifestHash:string;artifactHash:string;attestationSignature:string;timestampedAt:string}){
 const key=privateKey();
 const publicKey=createPublicKey(key);
 const publicDer=publicKey.export({format:"der",type:"spki"}) as Buffer;
 const payload=timestampPayload(input.manifestHash,input.artifactHash,input.attestationSignature,input.timestampedAt);
 return {
  algorithm:"Ed25519" as const,
  keyId:currentSidecEd25519KeyId(),
  statementHash:createHash("sha256").update(payload).digest("hex"),
  signature:sign(null,payload,key).toString("base64"),
  publicKey:publicKey.export({format:"pem",type:"spki"}).toString(),
  publicKeyFingerprint:createHash("sha256").update(publicDer).digest("hex")
 };
}

export function signSidecContinuityChangeReport(input:{reportHash:string;proposalId:string;targetPlanId:string;sealedAt:string}){
 const key=privateKey();
 const publicKey=createPublicKey(key);
 const publicDer=publicKey.export({format:"der",type:"spki"}) as Buffer;
 const payload=continuityChangeReportPayload(input);
 return {
  algorithm:"Ed25519" as const,
  keyId:currentSidecEd25519KeyId(),
  signature:sign(null,payload,key).toString("base64"),
  publicKey:publicKey.export({format:"pem",type:"spki"}).toString(),
  publicKeyFingerprint:createHash("sha256").update(publicDer).digest("hex")
 };
}

export function verifySidecContinuityChangeReport(input:{
 reportHash:string;
 proposalId:string;
 targetPlanId:string;
 sealedAt:string;
 signature:string;
 publicKey:string;
 publicKeyFingerprint:string;
}){
 try{
  const fingerprint=fingerprintSidecPublicKey(input.publicKey);
  if(fingerprint!==input.publicKeyFingerprint)return false;
  return verify(
   null,
   continuityChangeReportPayload(input),
   createPublicKey(input.publicKey),
   Buffer.from(input.signature,"base64")
  );
 }catch{
  return false;
 }
}

export function verifySidecTimestamp(input:{
 manifestHash:string;
 artifactHash:string;
 attestationSignature:string;
 timestampedAt:string;
 statementHash:string;
 signature:string;
 publicKey:string;
 publicKeyFingerprint:string;
}){
 try{
  const fingerprint=fingerprintSidecPublicKey(input.publicKey);
  if(fingerprint!==input.publicKeyFingerprint)return false;
  const payload=timestampPayload(input.manifestHash,input.artifactHash,input.attestationSignature,input.timestampedAt);
  if(createHash("sha256").update(payload).digest("hex")!==input.statementHash)return false;
  return verify(null,payload,createPublicKey(input.publicKey),Buffer.from(input.signature,"base64"));
 }catch{
  return false;
 }
}


export function signAuditCheckpoint(input:AuditCheckpointSignatureInput){
 const key=privateKey();
 const publicKey=createPublicKey(key);
 const publicDer=publicKey.export({format:"der",type:"spki"}) as Buffer;
 return {
  algorithm:"Ed25519" as const,
  keyId:currentSidecEd25519KeyId(),
  signature:sign(null,auditCheckpointPayload(input),key).toString("base64"),
  publicKey:publicKey.export({format:"pem",type:"spki"}).toString(),
  publicKeyFingerprint:createHash("sha256").update(publicDer).digest("hex")
 };
}

export function verifyAuditCheckpoint(input:AuditCheckpointSignatureInput&{
 signature:string;
 publicKey:string;
 publicKeyFingerprint:string;
}){
 try{
  const fingerprint=fingerprintSidecPublicKey(input.publicKey);
  if(fingerprint!==input.publicKeyFingerprint)return false;
  return verify(
   null,
   auditCheckpointPayload(input),
   createPublicKey(input.publicKey),
   Buffer.from(input.signature,"base64")
  );
 }catch{
  return false;
 }
}
