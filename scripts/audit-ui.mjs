import fs from "node:fs";
import path from "node:path";

const root=path.resolve("apps/web");
const app=path.join(root,"app");
const branding=path.join(root,"public","branding","defesa-civil-ubatuba.webp");

function walk(dir){
 const out=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())out.push(...walk(full));
  else out.push(full);
 }
 return out;
}
function fail(message,issues=[]){
 console.error(message);
 for(const issue of issues)console.error("- "+issue);
 process.exit(1);
}

if(!fs.existsSync(branding))fail("Logo institucional local da Defesa Civil ausente.");
const pages=walk(app).filter(f=>/\.(tsx|ts|css)$/.test(f));
const texts=new Map(pages.map(f=>[f,fs.readFileSync(f,"utf8")]));

const obsolete=[];
for(const [file,content] of texts){
 if(content.includes("logo_defesa_civil_edit"))obsolete.push(path.relative(process.cwd(),file));
}
if(obsolete.length)fail("Referência obsoleta ao logo remoto da Defesa Civil.",obsolete);

const required=[
 ["app/login/page.tsx","data:image/webp;base64,"],
 ["app/painel/page.tsx","/branding/defesa-civil-ubatuba.webp"],
 ["app/GlobalExperience.tsx","moduleHeaderInstitutionalMarks"],
 ["app/GlobalExperience.tsx","Brasão da Prefeitura Municipal de Ubatuba"],
 ["app/login/page.tsx","institutionalMark"],
 ["app/painel/page.tsx","opsBrandMark"],
 ["app/GlobalSidebar.tsx","globalBrandMark"]
];
for(const [rel,needle] of required){
 const file=path.join(root,rel),content=fs.readFileSync(file,"utf8");
 if(!content.includes(needle))fail("Padrão institucional ausente em "+rel+": "+needle);
}

const sidebar=fs.readFileSync(path.join(app,"GlobalSidebar.tsx"),"utf8");
if(sidebar.includes("globalNavGroupButton")||sidebar.includes('">{isOpen?"−":"+"}</'))fail("Accordion +/− voltou ao menu global.");

const missingAlt=[];
for(const [file,content] of texts){
 if(!file.endsWith(".tsx"))continue;
 for(const match of content.matchAll(/<img\b[^>]*>/gs)){
  if(!/\balt\s*=/.test(match[0])){
   const line=content.slice(0,match.index??0).split("\n").length;
   missingAlt.push(path.relative(process.cwd(),file)+":"+line);
  }
 }
}
if(missingAlt.length)fail("Imagem sem texto alternativo.",missingAlt);

const css=fs.readFileSync(path.join(app,"modern-ui.css"),"utf8");
for(const selector of [".institutionalMark",".opsBrandMark",".globalBrandMark",".moduleHeaderInstitutionalMarks",".moduleHeaderMark",":focus-visible"]){
 if(!css.includes(selector))fail("Design system incompleto: "+selector);
}

console.log("Auditoria visual: brasão da PMU e logo da Defesa Civil garantidos nos cabeçalhos; identidade institucional, abas e foco acessível validados.");
