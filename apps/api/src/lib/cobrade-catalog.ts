export type CobradeCatalogItem={
 code:string;
 name:string;
 group?:string;
 subgroup?:string;
 type?:string;
 subtype?:string;
};

function normalizeHeader(value:string){
 return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
}

function splitLine(line:string,delimiter:string){
 const out:string[]=[];let current="";let quoted=false;
 for(let i=0;i<line.length;i++){
  const ch=line[i];
  if(ch==='"'){
   if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;
  }else if(ch===delimiter&&!quoted){out.push(current.trim());current="";}
  else current+=ch;
 }
 out.push(current.trim());
 return out;
}

export function parseCobradeCatalogCsv(csv:string):CobradeCatalogItem[]{
 const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(lines.length<2)throw new Error("COBRADE_CSV_EMPTY");
 const delimiter=lines[0].includes(";")?";":",";
 const headers=splitLine(lines[0],delimiter).map(normalizeHeader);
 const index=(...names:string[])=>headers.findIndex(h=>names.includes(h));
 const codeIndex=index("codigo","codigocobrade","cobrade","code");
 const nameIndex=index("nome","descricao","denominacao","name");
 if(codeIndex<0||nameIndex<0)throw new Error("COBRADE_CSV_HEADERS");
 const groupIndex=index("grupo","group");
 const subgroupIndex=index("subgrupo","subgroup");
 const typeIndex=index("tipo","type");
 const subtypeIndex=index("subtipo","subtype");
 const items:CobradeCatalogItem[]=[];
 const seen=new Set<string>();
 for(const line of lines.slice(1)){
  const cols=splitLine(line,delimiter);
  const code=(cols[codeIndex]??"").trim();
  const name=(cols[nameIndex]??"").trim();
  if(!code||!name)continue;
  if(seen.has(code))throw new Error("COBRADE_CSV_DUPLICATE:"+code);
  seen.add(code);
  items.push({
   code,name,
   group:groupIndex>=0?(cols[groupIndex]??"").trim()||undefined:undefined,
   subgroup:subgroupIndex>=0?(cols[subgroupIndex]??"").trim()||undefined:undefined,
   type:typeIndex>=0?(cols[typeIndex]??"").trim()||undefined:undefined,
   subtype:subtypeIndex>=0?(cols[subtypeIndex]??"").trim()||undefined:undefined
  });
 }
 if(!items.length)throw new Error("COBRADE_CSV_NO_ITEMS");
 return items;
}
