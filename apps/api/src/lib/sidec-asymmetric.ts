import { createHash,createPrivateKey,createPublicKey,sign,verify } from "node:crypto";

const proofDomain="SIGDEC/SIDEC/INTEGRITY/ED25519/v1";
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
