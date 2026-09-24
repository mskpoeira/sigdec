import { createHash,createHmac,timingSafeEqual } from "node:crypto";

const domain="SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1";
const legacyKeyId="legacy-v1";

function assertSecret(secret:string,keyId:string){
 if(secret.length<32)throw new Error(`Segredo da chave SIDEC ${keyId} deve possuir pelo menos 32 caracteres.`);
 return secret;
}

function legacySecret(){
 const secret=process.env.SIDEC_MANIFEST_SIGNING_SECRET??process.env.JWT_SECRET;
 if(!secret)throw new Error("SIDEC_MANIFEST_SIGNING_SECRET ou JWT_SECRET deve estar configurado.");
 return assertSecret(secret,legacyKeyId);
}

function configuredKeyMap(){
 const raw=process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON?.trim();
 if(!raw)return {} as Record<string,string>;
 let parsed:unknown;
 try{parsed=JSON.parse(raw)}catch{throw new Error("SIDEC_MANIFEST_SIGNING_KEYS_JSON contém JSON inválido.");}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("SIDEC_MANIFEST_SIGNING_KEYS_JSON deve ser um objeto JSON.");
 const map:Record<string,string>={};
 for(const [id,value] of Object.entries(parsed as Record<string,unknown>)){
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(id))throw new Error(`ID de chave SIDEC inválido: ${id}`);
  if(typeof value!=="string")throw new Error(`Segredo da chave SIDEC ${id} deve ser string.`);
  map[id]=assertSecret(value,id);
 }
 return map;
}

export function currentSidecSigningKeyId(){
 return process.env.SIDEC_MANIFEST_SIGNING_KEY_ID?.trim()||legacyKeyId;
}

function secretForKey(keyId:string){
 const map=configuredKeyMap();
 if(map[keyId])return map[keyId];
 if(keyId===legacyKeyId)return legacySecret();
 const current=currentSidecSigningKeyId();
 if(keyId===current&&process.env.SIDEC_MANIFEST_SIGNING_SECRET)return assertSecret(process.env.SIDEC_MANIFEST_SIGNING_SECRET,keyId);
 throw new Error(`Chave de assinatura SIDEC não disponível: ${keyId}`);
}

function derivedKey(keyId:string){
 const context=keyId===legacyKeyId?domain:`${domain}:${keyId}`;
 return createHmac("sha256",secretForKey(keyId)).update(context,"utf8").digest();
}

export function signSidecManifestHashVersioned(manifestHash:string,keyId=currentSidecSigningKeyId()){
 return {
  keyId,
  signature:createHmac("sha256",derivedKey(keyId)).update(manifestHash,"utf8").digest("hex")
 };
}

export function signSidecManifestHash(manifestHash:string){
 return signSidecManifestHashVersioned(manifestHash).signature;
}

export function verifySidecManifestSignature(manifestHash:string,signature:string,keyId=currentSidecSigningKeyId()){
 const expected=Buffer.from(signSidecManifestHashVersioned(manifestHash,keyId).signature,"hex");
 const received=Buffer.from(signature,"hex");
 return expected.length===received.length&&timingSafeEqual(expected,received);
}

export function hashBinary(data:Buffer){
 return createHash("sha256").update(data).digest("hex");
}
