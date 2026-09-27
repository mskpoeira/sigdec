import tls from "node:tls";
import nodemailer from "nodemailer";

export type InstitutionalMailStatus={
 configured:boolean;
 smtp:{host:string;port:number;secure:boolean;userConfigured:boolean};
 imap:{host:string;port:number;secure:boolean;userConfigured:boolean};
 webmailUrl:string;
 mailboxLabel:string;
};

function bool(value:string|undefined,fallback:boolean){if(value==null)return fallback;return value.toLowerCase()==="true"}
function cfg(){
 const smtpHost=(process.env.INSTITUTIONAL_SMTP_HOST??"mail.ubatuba.sp.gov.br").trim();
 const smtpPort=Number(process.env.INSTITUTIONAL_SMTP_PORT??465);
 const smtpSecure=bool(process.env.INSTITUTIONAL_SMTP_SECURE,smtpPort===465);
 const imapHost=(process.env.INSTITUTIONAL_IMAP_HOST??"mail.ubatuba.sp.gov.br").trim();
 const imapPort=Number(process.env.INSTITUTIONAL_IMAP_PORT??993);
 const imapSecure=bool(process.env.INSTITUTIONAL_IMAP_SECURE,true);
 const user=(process.env.INSTITUTIONAL_MAIL_USER??"").trim();
 const password=process.env.INSTITUTIONAL_MAIL_PASSWORD??"";
 return {smtpHost,smtpPort,smtpSecure,imapHost,imapPort,imapSecure,user,password,
  from:(process.env.INSTITUTIONAL_MAIL_FROM??user).trim(),
  webmailUrl:(process.env.INSTITUTIONAL_WEBMAIL_URL??"https://webmail.ubatuba.sp.gov.br/").trim(),
  mailboxLabel:(process.env.INSTITUTIONAL_MAILBOX_LABEL??"Webmail da Prefeitura de Ubatuba").trim()
 };
}
export function institutionalMailStatus():InstitutionalMailStatus{
 const c=cfg();return {
  configured:Boolean(c.user&&c.password),
  smtp:{host:c.smtpHost,port:c.smtpPort,secure:c.smtpSecure,userConfigured:Boolean(c.user)},
  imap:{host:c.imapHost,port:c.imapPort,secure:c.imapSecure,userConfigured:Boolean(c.user)},
  webmailUrl:c.webmailUrl,mailboxLabel:c.mailboxLabel
 };
}
export async function verifyInstitutionalSmtp(){
 const c=cfg();if(!c.user||!c.password)throw new Error("E-mail institucional ainda não possui credenciais configuradas no servidor.");
 const transport=nodemailer.createTransport({host:c.smtpHost,port:c.smtpPort,secure:c.smtpSecure,auth:{user:c.user,pass:c.password}});
 await transport.verify();return {ok:true};
}
export async function sendInstitutionalMail(input:{to:string[];cc?:string[];subject:string;text:string;replyTo?:string}){
 const c=cfg();if(!c.user||!c.password)throw new Error("E-mail institucional ainda não possui credenciais configuradas no servidor.");
 const transport=nodemailer.createTransport({host:c.smtpHost,port:c.smtpPort,secure:c.smtpSecure,auth:{user:c.user,pass:c.password}});
 const result=await transport.sendMail({from:c.from||c.user,to:input.to,cc:input.cc?.length?input.cc:undefined,replyTo:input.replyTo,subject:input.subject,text:input.text});
 return {messageId:result.messageId,accepted:(result.accepted??[]).map(String),rejected:(result.rejected??[]).map(String)};
}

function q(value:string){return '"'+value.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'}
function decodeHeader(value:string){
 return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi,(_,v)=>{try{return Buffer.from(v,"base64").toString("utf8")}catch{return v}})
  .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi,(_,v)=>String(v).replace(/_/g," ").replace(/=([0-9A-F]{2})/gi,(_m,h)=>String.fromCharCode(parseInt(h,16))));
}
function extractHeader(block:string,name:string){
 const m=block.match(new RegExp("^"+name+":\\s*(.+(?:\\r?\\n[ \\t].+)*)","im"));return m?decodeHeader(m[1].replace(/\r?\n[ \t]+/g," ").trim()):null;
}
async function imapSession<T>(fn:(command:(value:string)=>Promise<string>)=>Promise<T>):Promise<T>{
 const c=cfg();if(!c.user||!c.password)throw new Error("E-mail institucional ainda não possui credenciais configuradas no servidor.");
 if(!c.imapSecure)throw new Error("Por segurança, o SIGDEC exige IMAP sobre TLS.");
 return await new Promise<T>((resolve,reject)=>{
  const socket=tls.connect({host:c.imapHost,port:c.imapPort,servername:c.imapHost,rejectUnauthorized:true});
  let buffer="",tagCounter=1,current:{tag:string;resolve:(v:string)=>void;reject:(e:Error)=>void}|null=null,ready=false;
  const timeout=setTimeout(()=>{socket.destroy();reject(new Error("Tempo esgotado ao conectar ao IMAP institucional."))},12000);
  const cleanup=()=>clearTimeout(timeout);
  socket.setEncoding("utf8");
  socket.on("error",e=>{cleanup();reject(e)});
  socket.on("data",chunk=>{
   buffer+=chunk;
   if(!ready&&/^(\* OK|\* PREAUTH)/m.test(buffer)){ready=true;run().catch(e=>{socket.destroy();cleanup();reject(e)})}
   if(current){
    const re=new RegExp("(?:^|\\r?\\n)"+current.tag+" (OK|NO|BAD) ([^\\r\\n]*)","m"),m=buffer.match(re);
    if(m){const all=buffer;const cur=current;current=null;buffer="";if(m[1]==="OK")cur.resolve(all);else cur.reject(new Error("IMAP: "+m[2]))}
   }
  });
  const command=(value:string)=>new Promise<string>((res,rej)=>{
   if(current)return rej(new Error("Comando IMAP concorrente não permitido."));
   const tag="A"+String(tagCounter++).padStart(4,"0");current={tag,resolve:res,reject:rej};socket.write(tag+" "+value+"\r\n");
  });
  const run=async()=>{
   await command("LOGIN "+q(c.user)+" "+q(c.password));
   const result=await fn(command);
   await command("LOGOUT").catch(()=>{});socket.end();cleanup();resolve(result);
  };
 });
}
export async function listInstitutionalInbox(limit=25){
 const safeLimit=Math.max(1,Math.min(50,Math.floor(limit)));
 return imapSession(async command=>{
  await command("EXAMINE INBOX");
  const search=await command("UID SEARCH ALL");
  const line=search.split(/\r?\n/).find(x=>x.startsWith("* SEARCH "))??"";
  const uids=line.replace("* SEARCH ","").trim().split(/\s+/).filter(Boolean).slice(-safeLimit).reverse();
  const items:Array<{uid:string;from:string|null;subject:string|null;date:string|null;messageId:string|null}>=[];
  for(const uid of uids){
   const raw=await command("UID FETCH "+uid+" (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])");
   items.push({uid,from:extractHeader(raw,"From"),subject:extractHeader(raw,"Subject"),date:extractHeader(raw,"Date"),messageId:extractHeader(raw,"Message-ID")});
  }
  return items;
 });
}
