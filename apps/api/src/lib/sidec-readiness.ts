export type SidecMapping={
 sourcePath:string;
 targetField:string;
 required:boolean;
 enabled:boolean;
 sortOrder:number;
};

export type CobradeRequirement={sourcePath:string;label:string;required:boolean;enabled:boolean;sortOrder:number};
export type SidecDocumentRequirement={
 scopeType:"DEFAULT"|"COBRADE"|"INCIDENT_TYPE";
 scopeValue:string;
 documentType:"REPORT"|"OPINION"|"INTERDICTION"|"DECLARATION"|"FORM"|"OTHER";
 label:string;
 minCount:number;
 required:boolean;
 enabled:boolean;
};
export type SidecAvailableDocument={id:string;documentType:string;issuedAt?:string|null};

export type ReadinessCheck={
 code:string;
 label:string;
 required:boolean;
 ok:boolean;
 detail?:string;
};

export function getPath(root:unknown,path:string):unknown{
 const parts=path.split(".").filter(Boolean);
 let current:unknown=root;
 for(const part of parts){
  if(!current||typeof current!=="object")return undefined;
  current=(current as Record<string,unknown>)[part];
 }
 return current;
}

function hasValue(value:unknown){
 if(value===null||value===undefined)return false;
 if(typeof value==="string")return value.trim().length>0;
 if(Array.isArray(value))return value.length>0;
 return true;
}

export function buildMappedFields(root:unknown,mappings:SidecMapping[]){
 const out:Record<string,unknown>={};
 for(const mapping of mappings.filter(x=>x.enabled).sort((a,b)=>a.sortOrder-b.sortOrder)){
  out[mapping.targetField]=getPath(root,mapping.sourcePath)??null;
 }
 return out;
}

export function evaluateSidecReadiness(root:Record<string,unknown>,mappings:SidecMapping[]):ReadinessCheck[]{
 const checks:ReadinessCheck[]=[];
 for(const mapping of mappings.filter(x=>x.enabled&&x.required).sort((a,b)=>a.sortOrder-b.sortOrder)){
  const value=getPath(root,mapping.sourcePath);
  checks.push({
   code:"mapping:"+mapping.targetField,
   label:mapping.targetField,
   required:true,
   ok:hasValue(value),
   detail:hasValue(value)?undefined:`Campo obrigatório ausente: ${mapping.sourcePath}`
  });
 }
 const incident=(root.incident??{}) as Record<string,unknown>;
 const hasAddress=hasValue(incident.addressLine)&&hasValue(incident.neighborhood);
 const hasCoordinates=hasValue(incident.latitude)&&hasValue(incident.longitude);
 checks.push({
  code:"location",
  label:"Localização",
  required:true,
  ok:hasAddress||hasCoordinates,
  detail:hasAddress||hasCoordinates?undefined:"Informe endereço + bairro ou latitude + longitude."
 });
 return checks;
}

export function evaluateCobradeRequirements(root:Record<string,unknown>,requirements:CobradeRequirement[]):ReadinessCheck[]{
 return requirements.filter(x=>x.enabled).sort((a,b)=>a.sortOrder-b.sortOrder).map(rule=>{
  const value=getPath(root,rule.sourcePath);
  return {
   code:"cobrade:"+rule.sourcePath,
   label:rule.label,
   required:rule.required,
   ok:hasValue(value),
   detail:hasValue(value)?undefined:`Requisito COBRADE pendente: ${rule.sourcePath}`
  };
 });
}

export function mergeDocumentRequirements(requirements:SidecDocumentRequirement[]){
 const grouped=new Map<string,SidecDocumentRequirement>();
 for(const rule of requirements.filter(x=>x.enabled)){
  const current=grouped.get(rule.documentType);
  if(!current||rule.minCount>current.minCount||(!current.required&&rule.required)){
   grouped.set(rule.documentType,{...rule});
  }
 }
 return [...grouped.values()].sort((a,b)=>a.documentType.localeCompare(b.documentType));
}

export function evaluateDocumentRequirements(documents:SidecAvailableDocument[],requirements:SidecDocumentRequirement[],selectedIds?:string[]):ReadinessCheck[]{
 const effective=mergeDocumentRequirements(requirements);
 const selected=selectedIds?new Set(selectedIds):null;
 return effective.map(rule=>{
  const count=documents.filter(doc=>doc.documentType===rule.documentType&&(!selected||selected.has(doc.id))).length;
  return {
   code:"document:"+rule.documentType,
   label:rule.label,
   required:rule.required,
   ok:count>=rule.minCount,
   detail:count>=rule.minCount?undefined:`Exigidos ${rule.minCount} documento(s) ${rule.documentType}; disponível/selecionado: ${count}.`
  };
 });
}

export function chooseRequiredDocumentIds(documents:SidecAvailableDocument[],requirements:SidecDocumentRequirement[]){
 const ids:string[]=[];
 for(const rule of mergeDocumentRequirements(requirements)){
  if(!rule.required)continue;
  const matches=documents
   .filter(doc=>doc.documentType===rule.documentType)
   .sort((a,b)=>String(b.issuedAt??"").localeCompare(String(a.issuedAt??"")))
   .slice(0,rule.minCount);
  for(const doc of matches)if(!ids.includes(doc.id))ids.push(doc.id);
 }
 return ids;
}

export function isSidecReady(checks:ReadinessCheck[]){
 return checks.filter(x=>x.required).every(x=>x.ok);
}

export type SidecDiff={path:string;before:unknown;after:unknown};

export function diffSidecValues(before:unknown,after:unknown,path=""):SidecDiff[]{
 if(Object.is(before,after))return [];
 if(Array.isArray(before)||Array.isArray(after)){
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  return [{path:path||"$",before,after}];
 }
 if(before&&after&&typeof before==="object"&&typeof after==="object"){
  const a=before as Record<string,unknown>,b=after as Record<string,unknown>;
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  return keys.flatMap(key=>diffSidecValues(a[key],b[key],path?`${path}.${key}`:key));
 }
 return [{path:path||"$",before,after}];
}
