import { createHash,createHmac,timingSafeEqual } from "node:crypto";

const domain="SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1";

function baseSecret(){
 const secret=process.env.SIDEC_MANIFEST_SIGNING_SECRET??process.env.JWT_SECRET;
 if(!secret||secret.length<32)throw new Error("SIDEC_MANIFEST_SIGNING_SECRET ou JWT_SECRET deve possuir pelo menos 32 caracteres.");
 return secret;
}

function derivedKey(){
 return createHmac("sha256",baseSecret()).update(domain,"utf8").digest();
}

export function signSidecManifestHash(manifestHash:string){
 return createHmac("sha256",derivedKey()).update(manifestHash,"utf8").digest("hex");
}

export function verifySidecManifestSignature(manifestHash:string,signature:string){
 const expected=Buffer.from(signSidecManifestHash(manifestHash),"hex");
 const received=Buffer.from(signature,"hex");
 return expected.length===received.length&&timingSafeEqual(expected,received);
}

export function hashBinary(data:Buffer){
 return createHash("sha256").update(data).digest("hex");
}
