import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const webApp=path.join(root,"apps","web","app");
const apiRoutesDir=path.join(root,"apps","api","src","routes");

function walk(dir){
 const out=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())out.push(...walk(full));
  else out.push(full);
 }
 return out;
}

function routeFromPage(file){
 const rel=path.relative(webApp,file).replaceAll(path.sep,"/");
 const base="/"+rel.replace(/\/page\.tsx$/,"");
 return base==="/" ? "/" : base;
}

const pageFiles=walk(webApp).filter(f=>f.endsWith(path.sep+"page.tsx"));
const routes=pageFiles.map(routeFromPage);
const routeRegexes=routes.map(route=>{
 const source="^"+route
  .replace(/[.*+?^\${}()|[\]\\]/g,"\\$&")
  .replace(/\\\[[^/]+\\\]/g,"[^/]+")+"$";
 return {route,re:new RegExp(source)};
});
function routeExists(candidate){
 const clean=(candidate.split("#")[0]||"/").split("?")[0]||"/";
 return routeRegexes.some(x=>x.re.test(clean));
}

const broken=[];
const webFiles=walk(webApp).filter(f=>/\.(tsx|ts)$/.test(f));
for(const file of webFiles){
 const content=fs.readFileSync(file,"utf8");
 const patterns=[
  /href\s*=\s*["'](\/[^"'{}]+)["']/g,
  /href\s*=\s*\{\s*["'](\/[^"'{}]+)["']\s*\}/g
 ];
 for(const re of patterns){
  let m;
  while((m=re.exec(content))){
   const target=m[1];
   if(target.startsWith("/api/")||target.startsWith("/auth/"))continue;
   if(!routeExists(target))broken.push({file:path.relative(root,file),target});
  }
 }
}

const adminUsers=path.join(apiRoutesDir,"admin-users.ts");
if(fs.existsSync(adminUsers)){
 const content=fs.readFileSync(adminUsers,"utf8");
 const match=content.match(/const navigationPaths=\[([\s\S]*?)\] as const;/);
 if(match){
  const quoted=/["'](\/[^"']+)["']/g;
  let m;
  while((m=quoted.exec(match[1]))){
   if(!routeExists(m[1]))broken.push({file:path.relative(root,adminUsers),target:m[1]});
  }
 }
}

const endpointOwners=new Map();
const duplicates=[];
for(const file of walk(apiRoutesDir).filter(f=>f.endsWith(".ts"))){
 const content=fs.readFileSync(file,"utf8");
 const re=/app\.(get|post|put|patch|delete)\(\s*["'\`]([^"'\`]+)["'\`]/g;
 let m;
 while((m=re.exec(content))){
  const key=m[1].toUpperCase()+" "+m[2];
  const owner=path.relative(root,file);
  if(endpointOwners.has(key))duplicates.push({endpoint:key,files:[endpointOwners.get(key),owner]});
  else endpointOwners.set(key,owner);
 }
}

if(broken.length||duplicates.length){
 console.error("SIGDEC architecture verification failed.");
 if(broken.length){
  console.error("\\nBroken internal routes:");
  for(const item of broken)console.error(" - "+item.target+" referenced by "+item.file);
 }
 if(duplicates.length){
  console.error("\\nDuplicate API routes:");
  for(const item of duplicates)console.error(" - "+item.endpoint+": "+item.files.join(", "));
 }
 process.exit(1);
}

console.log("Architecture OK: "+routes.length+" web pages, "+endpointOwners.size+" API routes, no duplicate endpoints or broken static links.");
