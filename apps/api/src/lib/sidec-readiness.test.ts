import assert from "node:assert/strict";
import test from "node:test";
import { buildMappedFields,chooseRequiredDocumentIds,diffSidecValues,evaluateCobradeRequirements,evaluateDocumentRequirements,evaluateSidecReadiness,isSidecReady,mergeDocumentRequirements,type SidecMapping } from "./sidec-readiness.js";

const mappings:SidecMapping[]=[
 {sourcePath:"incident.protocol",targetField:"ocorrencia.protocolo",required:true,enabled:true,sortOrder:10},
 {sourcePath:"incident.cobradeCode",targetField:"ocorrencia.cobrade",required:true,enabled:true,sortOrder:20}
];

test("checklist bloqueia COBRADE ausente",()=>{
 const root={incident:{protocol:"DC-1",cobradeCode:null,addressLine:"Rua A",neighborhood:"Centro"}};
 const checks=evaluateSidecReadiness(root,mappings);
 assert.equal(isSidecReady(checks),false);
 assert.ok(checks.some(x=>x.code==="mapping:ocorrencia.cobrade"&&!x.ok));
});

test("localizacao aceita coordenadas sem endereco",()=>{
 const root={incident:{protocol:"DC-1",cobradeCode:"123",latitude:-23.4,longitude:-45.1}};
 assert.equal(isSidecReady(evaluateSidecReadiness(root,mappings)),true);
});

test("gera campos mapeados",()=>{
 const root={incident:{protocol:"DC-1",cobradeCode:"123"}};
 const mapped=buildMappedFields(root,mappings);
 assert.equal(mapped["ocorrencia.protocolo"],"DC-1");
 assert.equal(mapped["ocorrencia.cobrade"],"123");
});

test("diff retorna somente campos alterados",()=>{
 const diff=diffSidecValues({a:1,b:{c:2}},{a:1,b:{c:3}});
 assert.deepEqual(diff,[{path:"b.c",before:2,after:3}]);
});


test("requisito adicional por COBRADE integra o checklist",()=>{
 const root={incident:{protocol:"DC-1",cobradeCode:"123",addressLine:"Rua A",neighborhood:"Centro",description:""}};
 const extra=evaluateCobradeRequirements(root,[{sourcePath:"incident.description",label:"Descrição técnica",required:true,enabled:true,sortOrder:10}]);
 assert.equal(extra.length,1);
 assert.equal(extra[0]?.ok,false);
 assert.equal(isSidecReady([...evaluateSidecReadiness(root,mappings),...extra]),false);
});


test("requisitos documentais usam maior minimo por tipo",()=>{
 const rules=[
  {scopeType:"DEFAULT" as const,scopeValue:"*",documentType:"REPORT" as const,label:"Relatório",minCount:1,required:true,enabled:true},
  {scopeType:"COBRADE" as const,scopeValue:"123",documentType:"REPORT" as const,label:"Relatórios COBRADE",minCount:2,required:true,enabled:true}
 ];
 const merged=mergeDocumentRequirements(rules);
 assert.equal(merged.length,1);
 assert.equal(merged[0]?.minCount,2);
});

test("documentos obrigatorios bloqueiam prontidao e selecionam os mais recentes",()=>{
 const rules=[{scopeType:"INCIDENT_TYPE" as const,scopeValue:"ALAG",documentType:"REPORT" as const,label:"Relatório técnico",minCount:2,required:true,enabled:true}];
 const docs=[
  {id:"1",documentType:"REPORT",issuedAt:"2026-09-20T10:00:00Z"},
  {id:"2",documentType:"REPORT",issuedAt:"2026-09-22T10:00:00Z"},
  {id:"3",documentType:"REPORT",issuedAt:"2026-09-23T10:00:00Z"}
 ];
 const checks=evaluateDocumentRequirements(docs,rules,["3"]);
 assert.equal(checks[0]?.ok,false);
 assert.deepEqual(chooseRequiredDocumentIds(docs,rules),["3","2"]);
});
