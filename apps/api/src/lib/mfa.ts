import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const BASE32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptionKey(){
 const source=(process.env.MFA_ENCRYPTION_SECRET||process.env.JWT_SECRET||"").trim();
 if(source.length<32)throw new Error("MFA_ENCRYPTION_SECRET ou JWT_SECRET deve possuir ao menos 32 caracteres.");
 return createHash("sha256").update("sigdec-mfa:"+source).digest();
}

export function base32Encode(input:Buffer){
 let bits=0,value=0,out="";
 for(const byte of input){
  value=(value<<8)|byte;bits+=8;
  while(bits>=5){out+=BASE32[(value>>>(bits-5))&31];bits-=5;}
 }
 if(bits>0)out+=BASE32[(value<<(5-bits))&31];
 return out;
}

export function base32Decode(input:string){
 const clean=input.toUpperCase().replace(/=+$/,"").replace(/[^A-Z2-7]/g,"");
 let bits=0,value=0;const out:number[]=[];
 for(const char of clean){
  const idx=BASE32.indexOf(char);if(idx<0)throw new Error("Segredo TOTP inválido.");
  value=(value<<5)|idx;bits+=5;
  if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}
 }
 return Buffer.from(out);
}

export function generateTotpSecret(){
 return base32Encode(randomBytes(20));
}

export function generateTotpCode(secret:string,atMs=Date.now(),digits=6,periodSeconds=30){
 const counter=Math.floor(atMs/1000/periodSeconds);
 const buffer=Buffer.alloc(8);
 buffer.writeBigUInt64BE(BigInt(counter));
 const digest=createHmac("sha1",base32Decode(secret)).update(buffer).digest();
 const offset=digest[digest.length-1]&0x0f;
 const binary=((digest[offset]&0x7f)<<24)|((digest[offset+1]&0xff)<<16)|((digest[offset+2]&0xff)<<8)|(digest[offset+3]&0xff);
 return String(binary%(10**digits)).padStart(digits,"0");
}

export function verifyTotp(secret:string,code:string,atMs=Date.now(),window=1){
 const normalized=code.replace(/s+/g,"");
 if(!/^d{6}$/.test(normalized))return false;
 for(let step=-window;step<=window;step++){
  const expected=generateTotpCode(secret,atMs+step*30000);
  const a=Buffer.from(expected),b=Buffer.from(normalized);
  if(a.length===b.length&&timingSafeEqual(a,b))return true;
 }
 return false;
}

export function encryptMfaSecret(secret:string){
 const iv=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
 const encrypted=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
 const tag=cipher.getAuthTag();
 return ["v1",iv.toString("base64url"),tag.toString("base64url"),encrypted.toString("base64url")].join(":");
}

export function decryptMfaSecret(payload:string){
 const [version,ivRaw,tagRaw,dataRaw]=payload.split(":");
 if(version!=="v1"||!ivRaw||!tagRaw||!dataRaw)throw new Error("Credencial MFA inválida.");
 const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(ivRaw,"base64url"));
 decipher.setAuthTag(Buffer.from(tagRaw,"base64url"));
 return Buffer.concat([decipher.update(Buffer.from(dataRaw,"base64url")),decipher.final()]).toString("utf8");
}

export function generateRecoveryCodes(count=10){
 return Array.from({length:count},()=>{
  const raw=base32Encode(randomBytes(8)).slice(0,12);
  return `SIGDEC-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
 });
}

export function normalizeRecoveryCode(code:string){
 return code.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
}

export function hashRecoveryCode(code:string){
 return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function buildTotpUri(input:{secret:string;account:string;issuer?:string}){
 const issuer=input.issuer??"SIGDEC";
 const label=encodeURIComponent(`${issuer}:${input.account}`);
 return `otpauth://totp/${label}?secret=${encodeURIComponent(input.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
