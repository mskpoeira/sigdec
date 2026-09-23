import assert from "node:assert/strict";
import test from "node:test";
import { buildSidecManifest,filterSidecDiffs,hashSidecManifest,sidecDiffCategory } from "./sidec-manifest.js";

test("manifesto e hash independem da ordem dos documentos",()=>{
 const a=buildSidecManifest({packageSchemaVersion:"1.1",revision:2,snapshotHash:"a".repeat(64),documents:[
  {id:"b",title:"B",documentType:"REPORT",revision:1,contentHash:"b".repeat(64)},
  {id:"a",title:"A",documentType:"REPORT",revision:1,contentHash:"c".repeat(64)}
 ]});
 const b=buildSidecManifest({packageSchemaVersion:"1.1",revision:2,snapshotHash:"a".repeat(64),documents:[
  {id:"a",title:"A",documentType:"REPORT",revision:1,contentHash:"c".repeat(64)},
  {id:"b",title:"B",documentType:"REPORT",revision:1,contentHash:"b".repeat(64)}
 ]});
 assert.deepEqual(a,b);
 assert.equal(hashSidecManifest(a),hashSidecManifest(b));
});

test("classifica e filtra diferencas por categoria",()=>{
 const diffs=[
  {path:"incident.summary",before:"A",after:"B"},
  {path:"documents",before:[],after:[1]},
  {path:"mappedFields.ocorrencia.resumo",before:"A",after:"B"}
 ];
 assert.equal(sidecDiffCategory("incident.summary"),"incident");
 assert.deepEqual(filterSidecDiffs(diffs,"documents"),[diffs[1]]);
 assert.equal(filterSidecDiffs(diffs,"all").length,3);
});
