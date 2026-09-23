import assert from "node:assert/strict";
import test from "node:test";
import { buildSidecPackage, canonicalJson, hashSidecPackage, sidecPackageSummaryCsv } from "./sidec-package.js";

test("hash canonico independe da ordem das chaves",()=>{
 const a={b:2,a:{y:2,x:1}};
 const b={a:{x:1,y:2},b:2};
 assert.equal(canonicalJson(a),canonicalJson(b));
 assert.equal(hashSidecPackage(a),hashSidecPackage(b));
});

test("gera pacote SIDEC com arrays vazios por padrao",()=>{
 const pkg=buildSidecPackage({generatedAt:"2026-09-23T18:00:00-03:00",municipality:{name:"Ubatuba",state:"SP"},incident:{protocol:"DC-2026-000001"}});
 assert.equal(pkg.schemaVersion,"1.0");
 assert.deepEqual(pkg.actions,[]);
 assert.deepEqual(pkg.inspections,[]);
});

test("csv resumo contem protocolo e COBRADE",()=>{
 const pkg=buildSidecPackage({generatedAt:"2026-09-23T18:00:00-03:00",municipality:{name:"Ubatuba",state:"SP"},incident:{protocol:"DC-2026-000001",cobradeCode:"TEST",summary:"Evento"}});
 const csv=sidecPackageSummaryCsv(pkg);
 assert.match(csv,/DC-2026-000001/);
 assert.match(csv,/TEST/);
});
