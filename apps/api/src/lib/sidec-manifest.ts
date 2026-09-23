import { canonicalJson } from "./sidec-package.js";
import { createHash } from "node:crypto";
import type { SidecDiff } from "./sidec-readiness.js";

export type SidecManifestDocument={
 id:string;
 number?:string|null;
 title:string;
 documentType:string;
 revision:number;
 contentHash?:string|null;
};

export type SidecManifest={
 schemaVersion:"sigdec-sidec-manifest/1.0";
 packageSchemaVersion:string;
 revision:number;
 snapshotHash:string;
 documents:SidecManifestDocument[];
};

export function buildSidecManifest(input:{
 packageSchemaVersion:string;
 revision:number;
 snapshotHash:string;
 documents:SidecManifestDocument[];
}):SidecManifest{
 return {
  schemaVersion:"sigdec-sidec-manifest/1.0",
  packageSchemaVersion:input.packageSchemaVersion,
  revision:input.revision,
  snapshotHash:input.snapshotHash,
  documents:[...input.documents].sort((a,b)=>a.id.localeCompare(b.id))
 };
}

export function hashSidecManifest(manifest:SidecManifest){
 return createHash("sha256").update(canonicalJson(manifest),"utf8").digest("hex");
}

export const sidecDiffCategories=[
 "incident","mappedFields","documents","actions","inspections","supportRequests",
 "humanitarianDeliveries","timeline","municipality","other"
] as const;

export type SidecDiffCategory=(typeof sidecDiffCategories)[number];

export function sidecDiffCategory(path:string):SidecDiffCategory{
 const root=path.split(".")[0]??"";
 if((sidecDiffCategories as readonly string[]).includes(root))return root as SidecDiffCategory;
 return "other";
}

export function filterSidecDiffs(diffs:SidecDiff[],category?:string){
 if(!category||category==="all")return diffs;
 if(!(sidecDiffCategories as readonly string[]).includes(category))return [];
 return diffs.filter(diff=>sidecDiffCategory(diff.path)===category);
}
