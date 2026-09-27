import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const app=path.join(root,"apps","web","app");

function walk(dir){
 const out=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())out.push(...walk(full));else out.push(full);
 }
 return out;
}
function routeFromPage(file){
 const rel=path.relative(app,file).replaceAll(path.sep,"/");
 const base="/"+rel.replace(/\/page\.tsx$/,"");
 return base==="/" ? "/" : base;
}
const excluded=new Set([
 "/","/login","/alterar-senha","/esqueci-senha","/redefinir-senha","/offline",
 "/verificar-integridade","/integridade/[hash]","/integridade/auditoria/[hash]","/ocorrencias/nova"
]);

const missing=[];
for(const file of walk(app).filter(x=>x.endsWith(path.sep+"page.tsx"))){
 const route=routeFromPage(file),content=fs.readFileSync(file,"utf8");
 if(excluded.has(route))continue;
 const client=/["']use client["']/.test(content);
 const dataDriven=content.includes("fetch(");
 if(!client||!dataDriven)continue;
 const covered=content.includes("useRealtimeRefresh")||content.includes("sigdec:realtime-tick");
 if(!covered)missing.push({route,file:path.relative(root,file)});
}

const globalFile=path.join(app,"GlobalExperience.tsx");
const global=fs.readFileSync(globalFile,"utf8");
const globalChecks=[
 ["EventSource",global.includes("new EventSource(")],
 ["SSE ready event",global.includes('addEventListener("ready"')],
 ["SSE change event",global.includes('addEventListener("change"')],
 ["polling only as fallback",global.includes('if(realtimeTransport==="sse")return')]
].filter(([,ok])=>!ok).map(([label])=>label);

if(missing.length||globalChecks.length){
 console.error("SIGDEC realtime verification failed.");
 for(const item of missing)console.error(" - Tela dinâmica sem barramento realtime: "+item.route+" ("+item.file+")");
 for(const label of globalChecks)console.error(" - GlobalExperience incompleto: "+label);
 process.exit(1);
}
console.log("Realtime OK: telas operacionais dinâmicas cobertas por SSE/event bus; polling reservado a fallback.");
