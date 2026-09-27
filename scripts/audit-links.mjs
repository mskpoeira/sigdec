import fs from "node:fs";
import path from "node:path";

const root=path.resolve("apps/web/app");
const textExtensions=new Set([".ts",".tsx",".js",".jsx"]);
const ignoredPrefixes=["/api/","/_next/"];
const explicitIgnore=new Set(["/favicon.ico"]);

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
 const rel=path.relative(root,path.dirname(file)).split(path.sep).filter(Boolean);
 if(rel.length===0)return "/";
 return "/"+rel.join("/");
}
function routeRegex(route){
 if(route==="/")return /^\/$/;
 const escaped=route.split("/").map(seg=>{
  if(/^\[\[\.\.\..+\]\]$/.test(seg))return ".*";
  if(/^\[\.\.\..+\]$/.test(seg))return ".+";
  if(/^\[.+\]$/.test(seg))return "[^/]+";
  return seg.replace(/[.*+?^\${}()|[\]\\]/g,"\\$&");
 }).join("/");
 return new RegExp("^"+escaped+"/?$");
}
function normalizeHref(raw){
 if(!raw.startsWith("/")||raw.startsWith("//"))return null;
 const clean=raw.split("#")[0].split("?")[0]||"/";
 if(ignoredPrefixes.some(p=>clean.startsWith(p))||explicitIgnore.has(clean))return null;
 return clean;
}

const files=walk(root);
const routes=files.filter(f=>f.endsWith(path.sep+"page.tsx")||f.endsWith(path.sep+"page.jsx")).map(routeFromPage);
const matchers=routes.map(route=>({route,regex:routeRegex(route)}));
const internalRefs=[],externalRefs=[];

const internalPatterns=[
 /\bhref\s*=\s*["'](\/[^"'{}]*)["']/g,
 /\bhref\s*:\s*["'](\/[^"'{}]*)["']/g,
 /\bhref\s*=\s*\{\s*["'](\/[^"'{}]*)["']\s*\}/g,
 /\b(?:location\.href|location\.assign|location\.replace)\s*=*\s*\(?\s*["'](\/[^"'{}]*)["']/g,
 /\b(?:router\.(?:push|replace)|redirect)\s*\(\s*["'](\/[^"'{}]*)["']/g
];
const externalPatterns=[
 /\b(?:href|src)\s*=\s*["'](https?:\/\/[^"'{}\s]+)["']/g,
 /\b(?:url|webmailUrl)\s*:\s*["'](https?:\/\/[^"'{}\s]+)["']/g
];

for(const file of files.filter(f=>textExtensions.has(path.extname(f)))){
 const content=fs.readFileSync(file,"utf8");
 for(const pattern of internalPatterns){
  for(const match of content.matchAll(pattern)){
   const href=normalizeHref(match[1]);if(!href)continue;
   internalRefs.push({file:path.relative(process.cwd(),file),line:content.slice(0,match.index??0).split("\n").length,href});
  }
 }
 for(const pattern of externalPatterns){
  for(const match of content.matchAll(pattern)){
   externalRefs.push({file:path.relative(process.cwd(),file),line:content.slice(0,match.index??0).split("\n").length,url:match[1]});
  }
 }
}

const unique=new Map();
for(const ref of internalRefs)unique.set(ref.file+":"+ref.line+":"+ref.href,ref);
const broken=[...unique.values()].filter(ref=>!matchers.some(x=>x.regex.test(ref.href)));
const obsolete=externalRefs.flatMap(ref=>{
 const issues=[];
 if(/^https:\/\/chatgpt\.com\/\?model=gpt-4o\/?$/i.test(ref.url))issues.push({...ref,replacement:"https://chatgpt.com/"});
 if(/^http:\/\/(?!localhost|127\.0\.0\.1)/i.test(ref.url))issues.push({...ref,replacement:"usar HTTPS"});
 return issues;
});

if(broken.length||obsolete.length){
 if(broken.length){console.error("Links internos sem rota Next.js correspondente:");for(const x of broken)console.error("- "+x.file+":"+x.line+" -> "+x.href)}
 if(obsolete.length){console.error("Links externos obsoletos/inseguros:");for(const x of obsolete)console.error("- "+x.file+":"+x.line+" -> "+x.url+" | usar: "+x.replacement)}
 process.exit(1);
}
console.log("Auditoria de links: "+unique.size+" interno(s), "+externalRefs.length+" externo(s), "+routes.length+" rota(s), 0 quebrado/obsoleto conhecido.");
