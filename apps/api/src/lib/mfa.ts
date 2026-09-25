import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {decryptApplicationSecret,encryptApplicationSecret} from "./app-secrets.js";

const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(input:Buffer){
 let bits=0,value=0,out="";
 for(const byte of input){
  value=(value<<8)|byte;bits+=8;
  while(bits>=5){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}
 }
 if(bits>0)out+=ALPHABET[(value<<(5-bits))&31];
 return out;
}

export function base32Decode(input:string){
 const clean=input.toUpperCase().replace(/[^A-Z2-7]/g,"");
 let bits=0,value=0;const out:number[]=[];
 for(const ch of clean){
  const idx=ALPHABET.indexOf(ch);if(idx<0)throw new Error("Base32 inválido.");
  value=(value<<5)|idx;bits+=5;
  if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}
 }
 return Buffer.from(out);
}

export function generateTotpSecret(){return base32Encode(randomBytes(20));}

export function encryptTotpSecret(secret:string){return encryptApplicationSecret(secret);}
export function decryptTotpSecret(ciphertext:string){return decryptApplicationSecret(ciphertext);}

export function totpCode(secret:string,at=Date.now()){
 const counter=Math.floor(at/30000);
 const counterBytes=Buffer.alloc(8);
 counterBytes.writeBigUInt64BE(BigInt(counter));
 const digest=createHmac("sha1",base32Decode(secret)).update(counterBytes).digest();
 const offset=digest[digest.length-1]!&0x0f;
 const value=((digest[offset]!&0x7f)<<24)|((digest[offset+1]!&0xff)<<16)|((digest[offset+2]!&0xff)<<8)|(digest[offset+3]!&0xff);
 return String(value%1_000_000).padStart(6,"0");
}

export function verifyTotp(secret:string,code:string,at=Date.now()){
 const clean=code.replace(/\s/g,"");
 if(!/^\d{6}$/.test(clean))return false;
 for(const delta of [-30000,0,30000]){
  const expected=Buffer.from(totpCode(secret,at+delta));
  const actual=Buffer.from(clean);
  if(expected.length===actual.length&&timingSafeEqual(expected,actual))return true;
 }
 return false;
}

export function recoveryCode(){
 const raw=randomBytes(8).toString("hex").toUpperCase();
 return raw.slice(0,4)+"-"+raw.slice(4,8)+"-"+raw.slice(8,12)+"-"+raw.slice(12,16);
}
export function recoveryCodeHash(code:string){
 return createHash("sha256").update(code.trim().toUpperCase().replace(/\s/g,"")).digest("hex");
}
export function challengeHash(token:string){return createHash("sha256").update(token).digest("hex");}
export function newChallengeToken(){return randomBytes(32).toString("base64url");}
