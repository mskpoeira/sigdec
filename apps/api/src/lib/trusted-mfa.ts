import {createHash,randomBytes} from "node:crypto";
import type {FastifyReply} from "fastify";
import {db} from "../db.js";

export const TRUSTED_MFA_COOKIE="sigdec_trusted_device";

function hash(value:string){
 return createHash("sha256").update(value).digest("hex");
}

function days(){
 return Math.max(1,Math.min(180,Number(process.env.MFA_TRUSTED_DEVICE_DAYS??30)));
}

function userAgentHash(userAgent?:string){
 return hash(String(userAgent??"unknown"));
}

function deviceLabel(userAgent?:string){
 const ua=String(userAgent??"").toLowerCase();
 const os=ua.includes("iphone")?"iPhone":ua.includes("ipad")?"iPad":ua.includes("android")?"Android":ua.includes("windows")?"Windows":ua.includes("mac os")||ua.includes("macintosh")?"Mac":"Dispositivo";
 const browser=ua.includes("edg/")?"Edge":ua.includes("crios/")?"Chrome":ua.includes("chrome/")?"Chrome":ua.includes("fxios/")||ua.includes("firefox/")?"Firefox":ua.includes("safari/")?"Safari":"Navegador";
 return `${os} · ${browser}`;
}

export function setTrustedMfaCookie(reply:FastifyReply,token:string,expiresAt:Date){
 reply.setCookie(TRUSTED_MFA_COOKIE,token,{
  httpOnly:true,
  secure:process.env.NODE_ENV==="production",
  sameSite:"lax",
  path:"/",
  expires:expiresAt
 });
}

export function clearTrustedMfaCookie(reply:FastifyReply){
 reply.clearCookie(TRUSTED_MFA_COOKIE,{path:"/"});
}

export async function issueTrustedMfaDevice(input:{
 userId:string;
 reply:FastifyReply;
 ip?:string;
 userAgent?:string;
}){
 const token=randomBytes(32).toString("base64url");
 const tokenHash=hash(token);
 const uaHash=userAgentHash(input.userAgent);
 const expiresAt=new Date(Date.now()+days()*24*60*60*1000);

 await db.query(
  `UPDATE trusted_mfa_devices
      SET revoked_at=now()
    WHERE user_id=$1
      AND user_agent_hash=$2
      AND revoked_at IS NULL`,
  [input.userId,uaHash]
 );

 const inserted=await db.query<{id:string}>(
  `INSERT INTO trusted_mfa_devices
     (user_id,token_hash,user_agent_hash,device_label,first_ip,last_ip,expires_at)
   VALUES($1,$2,$3,$4,$5,$5,$6)
   RETURNING id`,
  [input.userId,tokenHash,uaHash,deviceLabel(input.userAgent),input.ip??null,expiresAt]
 );

 setTrustedMfaCookie(input.reply,token,expiresAt);
 return {id:inserted.rows[0]!.id,expiresAt,label:deviceLabel(input.userAgent),days:days()};
}

export async function validateTrustedMfaDevice(input:{
 userId:string;
 token?:string;
 ip?:string;
 userAgent?:string;
}){
 if(!input.token)return null;
 const tokenHash=hash(input.token);
 const result=await db.query<{
  id:string;
  user_agent_hash:string;
  expires_at:Date;
  device_label:string|null;
 }>(
  `SELECT id,user_agent_hash,expires_at,device_label
     FROM trusted_mfa_devices
    WHERE user_id=$1
      AND token_hash=$2
      AND revoked_at IS NULL
      AND expires_at>now()
    LIMIT 1`,
  [input.userId,tokenHash]
 );
 const item=result.rows[0];
 if(!item)return null;

 const expectedUa=userAgentHash(input.userAgent);
 if(item.user_agent_hash!==expectedUa){
  await db.query("UPDATE trusted_mfa_devices SET revoked_at=now() WHERE id=$1",[item.id]);
  return null;
 }

 await db.query(
  `UPDATE trusted_mfa_devices
      SET last_used_at=now(),last_ip=$2
    WHERE id=$1`,
  [item.id,input.ip??null]
 );

 return {id:item.id,expiresAt:item.expires_at,label:item.device_label};
}

export async function revokeTrustedMfaDevices(userId:string){
 const result=await db.query(
  `UPDATE trusted_mfa_devices
      SET revoked_at=now()
    WHERE user_id=$1
      AND revoked_at IS NULL`,
  [userId]
 );
 return result.rowCount??0;
}

export async function listTrustedMfaDevices(userId:string){
 const result=await db.query(
  `SELECT id,device_label AS "deviceLabel",first_ip::text AS "firstIp",last_ip::text AS "lastIp",
          created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt"
     FROM trusted_mfa_devices
    WHERE user_id=$1
      AND revoked_at IS NULL
      AND expires_at>now()
    ORDER BY COALESCE(last_used_at,created_at) DESC`,
  [userId]
 );
 return result.rows;
}

export async function revokeTrustedMfaDevice(userId:string,id:string){
 const result=await db.query(
  `UPDATE trusted_mfa_devices
      SET revoked_at=now()
    WHERE id=$1
      AND user_id=$2
      AND revoked_at IS NULL`,
  [id,userId]
 );
 return (result.rowCount??0)===1;
}
