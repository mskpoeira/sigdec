import {lookup} from "node:dns/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {db} from "../db.js";
import {decryptApplicationSecret} from "./app-secrets.js";
import {publicWebhookAddress} from "./webhooks.js";

export type SeiConnection={
 id:string;organizationId:string;name:string;baseUrl:string;wsdlUrl:string;systemCode:string;
 serviceKeyCiphertext:string|null;unitId:string;active:boolean;allowedOperations:string[];config:Record<string,any>;
};

function allowPrivate(){return process.env.SEI_ALLOW_PRIVATE_NETWORK==="true"}
async function resolveSafe(value:string){
 const url=new URL(value);
 if(url.username||url.password)throw new Error("Credenciais na URL do SEI não são permitidas.");
 if(!["https:","http:"].includes(url.protocol))throw new Error("Protocolo SEI não suportado.");
 const localDev=process.env.NODE_ENV!=="production"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname);
 if(url.protocol==="http:"&&!localDev&&!allowPrivate())throw new Error("Web Service SEI remoto deve usar HTTPS.");
 const hostname=url.hostname.replace(/^\[|\]$/g,"");
 const addresses=await lookup(hostname,{all:true,verbatim:true});if(!addresses.length)throw new Error("Host SEI não resolvido.");
 if(!allowPrivate()&&!localDev&&addresses.some(x=>!publicWebhookAddress(x.address)))throw new Error("Endpoint SEI em rede privada/local não autorizado. Configure SEI_ALLOW_PRIVATE_NETWORK=true somente no servidor municipal autorizado.");
 return {url,address:addresses[0]!.address,family:addresses[0]!.family};
}
export async function seiHttp(value:string,options:{method?:string;body?:string;headers?:Record<string,string>;maxBytes?:number}={}){
 const resolved=await resolveSafe(value),method=options.method??"GET",body=options.body;
 const headers:Record<string,string>={...(options.headers??{}),"user-agent":"SIGDEC-SEI/1.71"};
 if(body)headers["content-length"]=String(Buffer.byteLength(body));
 const maxBytes=options.maxBytes??20*1024*1024;
 return new Promise<{status:number;body:string;contentType:string}>((resolve,reject)=>{
  const req=(resolved.url.protocol==="https:"?httpsRequest:httpRequest)(resolved.url,{method,headers,lookup:(_h,_o,cb)=>cb(null,resolved.address,resolved.family),signal:AbortSignal.timeout(30000)},res=>{
   const chunks:Buffer[]=[];let total=0;
   res.on("data",(chunk:Buffer)=>{total+=chunk.length;if(total>maxBytes){req.destroy(new Error("Resposta SEI excedeu o limite permitido."));return}chunks.push(chunk)});
   res.on("end",()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),contentType:String(res.headers["content-type"]??"")}));
   res.on("error",reject);
  });
  req.on("error",reject);if(body)req.write(body);req.end();
 });
}
export async function loadSeiConnection(id:string,organizationId:string){
 const r=await db.query("SELECT id,organization_id AS \"organizationId\",name,base_url AS \"baseUrl\",wsdl_url AS \"wsdlUrl\",system_code AS \"systemCode\",service_key_ciphertext AS \"serviceKeyCiphertext\",unit_id AS \"unitId\",active,allowed_operations AS \"allowedOperations\",config FROM sei_connections WHERE id=$1 AND organization_id=$2 AND active=true",[id,organizationId]);
 return r.rows[0] as SeiConnection|undefined;
}
export function seiOperationsFromWsdl(xml:string){
 const values:string[]=[];
 for(const match of xml.matchAll(/<(?:\w+:)?operation\b[^>]*\bname=["']([^"']+)["']/gi)){const name=String(match[1]??"").trim();if(name&&!values.includes(name))values.push(name)}
 return values.sort();
}
function escapeXml(value:unknown){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[ch]??ch))}
function xmlNode(name:string,value:any):string{
 if(value===undefined||value===null)return "<"+name+" xsi:nil=\"true\"/>";
 if(Array.isArray(value))return "<"+name+">"+value.map(v=>xmlNode("item",v)).join("")+"</"+name+">";
 if(typeof value==="object")return "<"+name+">"+Object.entries(value).map(([k,v])=>xmlNode(k,v)).join("")+"</"+name+">";
 return "<"+name+">"+escapeXml(value)+"</"+name+">";
}
export function serviceIdentification(connection:SeiConnection){
 if(!connection.serviceKeyCiphertext)throw new Error("Identificação/segredo do serviço SEI não configurado.");
 return decryptApplicationSecret(connection.serviceKeyCiphertext);
}
export function assertSeiOperation(connection:SeiConnection,operation:string){
 const allowed=connection.allowedOperations??[];
 if(!allowed.includes(operation))throw Object.assign(new Error("Operação SEI não autorizada na configuração do SIGDEC: "+operation),{statusCode:403});
}
export async function seiSoapCall(connection:SeiConnection,operation:string,parameters:Record<string,any>){
 assertSeiOperation(connection,operation);
 const base={SiglaSistema:connection.systemCode,IdentificacaoServico:serviceIdentification(connection),IdUnidade:connection.unitId,...parameters};
 const body=Object.entries(base).map(([k,v])=>xmlNode(k,v)).join("");
 const envelope="<?xml version=\"1.0\" encoding=\"UTF-8\"?>"+
  "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:sei=\"Sei\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"+
  "<soapenv:Header/><soapenv:Body><sei:"+operation+">"+body+"</sei:"+operation+"></soapenv:Body></soapenv:Envelope>";
 const endpoint=connection.baseUrl||connection.wsdlUrl.replace(/\?.*$/,"");
 const response=await seiHttp(endpoint,{method:"POST",body:envelope,headers:{"content-type":"text/xml; charset=utf-8","soapaction":"\""+operation+"\""}});
 if(response.status<200||response.status>=300)throw Object.assign(new Error("SEI respondeu HTTP "+response.status),{httpStatus:response.status,body:response.body.slice(0,1500)});
 const fault=response.body.match(/<(?:\w+:)?Fault\b[\s\S]*?<\/(?:\w+:)?Fault>/i)?.[0];
 if(fault)throw new Error("SEI SOAP Fault: "+fault.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,1000));
 return {status:response.status,xml:response.body};
}
export function xmlTag(xml:string,name:string){
 const escaped=name.replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&");
 const match=xml.match(new RegExp("<(?:\\w+:)?"+escaped+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?"+escaped+">","i"));
 return match?match[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,"\"").replace(/&apos;/g,"'").trim():null;
}
export async function consultSeiProcess(connection:SeiConnection,protocol:string){
 const r=await seiSoapCall(connection,"consultarProcedimento",{
  ProtocoloProcedimento:protocol,SinRetornarAssuntos:"S",SinRetornarInteressados:"N",SinRetornarObservacoes:"N",
  SinRetornarAndamentoGeracao:"S",SinRetornarAndamentoConclusao:"S",SinRetornarUltimoAndamento:"S",
  SinRetornarUnidadesProcedimentoAberto:"S",SinRetornarProcedimentosRelacionados:"N",SinRetornarProcedimentosAnexados:"N"
 });
 return {protocol:xmlTag(r.xml,"ProcedimentoFormatado")??protocol,id:xmlTag(r.xml,"IdProcedimento"),link:xmlTag(r.xml,"LinkAcesso"),xml:r.xml};
}
export async function generateSeiProcess(connection:SeiConnection,input:{processTypeId:string;specification:string;subjectId?:string;accessLevel?:string;legalHypothesisId?:string;units?:string[]}){
 const procedure:any={IdTipoProcedimento:input.processTypeId,Especificacao:input.specification,NivelAcesso:input.accessLevel??connection.config?.accessLevel??"0"};
 if(input.legalHypothesisId)procedure.IdHipoteseLegal=input.legalHypothesisId;
 if(input.subjectId)procedure.Assuntos=[{CodigoEstruturado:input.subjectId}];
 const r=await seiSoapCall(connection,"gerarProcedimento",{Procedimento:procedure,Documentos:[],ProcedimentosRelacionados:[],UnidadesEnvio:input.units??[],SinManterAbertoUnidade:"S"});
 return {id:xmlTag(r.xml,"IdProcedimento"),protocol:xmlTag(r.xml,"ProcedimentoFormatado"),link:xmlTag(r.xml,"LinkAcesso"),xml:r.xml};
}
export async function includeSeiGeneratedDocument(connection:SeiConnection,input:{protocol:string;documentTypeId:string;description:string;content:string;accessLevel?:string;legalHypothesisId?:string}){
 const document:any={Tipo:"G",ProtocoloProcedimento:input.protocol,IdSerie:input.documentTypeId,Numero:null,Data:null,Descricao:input.description,Observacao:"Gerado pelo SIGDEC após aprovação humana.",NivelAcesso:input.accessLevel??connection.config?.accessLevel??"0",Conteudo:Buffer.from(input.content,"utf8").toString("base64"),SinBloqueado:"N"};
 if(input.legalHypothesisId)document.IdHipoteseLegal=input.legalHypothesisId;
 const r=await seiSoapCall(connection,"incluirDocumento",{Documento:document});
 return {id:xmlTag(r.xml,"IdDocumento"),protocol:xmlTag(r.xml,"DocumentoFormatado"),link:xmlTag(r.xml,"LinkAcesso"),xml:r.xml};
}
