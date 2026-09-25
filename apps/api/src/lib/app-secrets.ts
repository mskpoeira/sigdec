import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";

function key(){
 const source=(process.env.MFA_ENCRYPTION_KEY||process.env.JWT_SECRET||"").trim();
 if(source.length<32)throw new Error("MFA_ENCRYPTION_KEY ou JWT_SECRET deve possuir pelo menos 32 caracteres.");
 return createHash("sha256").update(source).digest();
}

export function encryptApplicationSecret(value:string){
 const iv=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",key(),iv);
 const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 const tag=cipher.getAuthTag();
 return ["v1",iv.toString("base64url"),tag.toString("base64url"),encrypted.toString("base64url")].join(".");
}

export function decryptApplicationSecret(value:string){
 const [version,ivRaw,tagRaw,dataRaw]=value.split(".");
 if(version!=="v1"||!ivRaw||!tagRaw||!dataRaw)throw new Error("Segredo cifrado inválido.");
 const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(ivRaw,"base64url"));
 decipher.setAuthTag(Buffer.from(tagRaw,"base64url"));
 return Buffer.concat([decipher.update(Buffer.from(dataRaw,"base64url")),decipher.final()]).toString("utf8");
}
