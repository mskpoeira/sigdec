import { createHash } from "node:crypto";

export type SidecPackage={
 schemaVersion:"1.0"|"1.1";
 generatedAt:string;
 municipality:{name:string;state:string;ibgeCode?:string|null};
 incident:Record<string,unknown>;
 actions:Array<Record<string,unknown>>;
 inspections:Array<Record<string,unknown>>;
 supportRequests:Array<Record<string,unknown>>;
 humanitarianDeliveries:Array<Record<string,unknown>>;
 timeline:Array<Record<string,unknown>>;
 documents:Array<Record<string,unknown>>;
 mappedFields:Record<string,unknown>;
};

function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==="object"){
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 }
 return value;
}

export function canonicalJson(value:unknown){
 return JSON.stringify(canonical(value));
}

export function hashSidecPackage(value:unknown){
 return createHash("sha256").update(canonicalJson(value),"utf8").digest("hex");
}

function csvCell(value:unknown){
 const text=value==null?"":typeof value==="string"?value:JSON.stringify(value);
 return `"${text.replaceAll('"','""')}"`;
}

export function sidecPackageSummaryCsv(pkg:SidecPackage){
 const mappedEntries=Object.entries(pkg.mappedFields??{});
 if(mappedEntries.length){
  const headers=mappedEntries.map(([key])=>key);
  const values=mappedEntries.map(([,value])=>value);
  return [headers,values].map(row=>row.map(csvCell).join(";")).join("\n");
 }
 const incident=pkg.incident;
 const rows=[
  ["schema_version","generated_at","municipality","state","protocol","status","priority","cobrade","summary","address","neighborhood","latitude","longitude"],
  [
   pkg.schemaVersion,pkg.generatedAt,pkg.municipality.name,pkg.municipality.state,
   incident.protocol,incident.status,incident.priority,incident.cobradeCode,incident.summary,
   incident.addressLine,incident.neighborhood,incident.latitude,incident.longitude
  ]
 ];
 return rows.map(row=>row.map(csvCell).join(";")).join("\n");
}

export function buildSidecPackage(input:{
 generatedAt?:string;
 municipality:{name:string;state:string;ibgeCode?:string|null};
 incident:Record<string,unknown>;
 actions?:Array<Record<string,unknown>>;
 inspections?:Array<Record<string,unknown>>;
 supportRequests?:Array<Record<string,unknown>>;
 humanitarianDeliveries?:Array<Record<string,unknown>>;
 timeline?:Array<Record<string,unknown>>;
 documents?:Array<Record<string,unknown>>;
 mappedFields?:Record<string,unknown>;
}):SidecPackage{
 return {
  schemaVersion:"1.1",
  generatedAt:input.generatedAt??new Date().toISOString(),
  municipality:input.municipality,
  incident:input.incident,
  actions:input.actions??[],
  inspections:input.inspections??[],
  supportRequests:input.supportRequests??[],
  humanitarianDeliveries:input.humanitarianDeliveries??[],
  timeline:input.timeline??[],
  documents:input.documents??[],
  mappedFields:input.mappedFields??{}
 };
}
