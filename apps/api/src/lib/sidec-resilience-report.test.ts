import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSidecResiliencePdf, resiliencePct } from "./sidec-resilience-report.js";

test("percentual de resiliência preserva duas casas e trata base zero",()=>{
  assert.equal(resiliencePct(3,4),75);
  assert.equal(resiliencePct(1,3),33.33);
  assert.equal(resiliencePct(0,0),null);
});

test("relatório PDF de resiliência gera documento válido",async()=>{
  const pdf=await buildSidecResiliencePdf({
    organizationName:"Prefeitura da Cidade de Ubatuba",
    report:{
      reportVersion:"sigdec-sidec-resilience-report/1.1",
      generatedAt:"2026-09-24T12:00:00.000Z",
      period:{days:30,from:"2026-08-25T12:00:00.000Z",to:"2026-09-24T12:00:00.000Z"},
      redundancy:{archives:4,replicas:4,coveragePct:100},
      primary:{checks:8,integrityCheckPct:100},
      replica:{checks:8,integrityCheckPct:100},
      restoreDrills:[{destination:"PRIMARY",drills:2,successful:2,successPct:100,averageDurationMs:120}],
      conditions:{detected:1,alerted:0,resolved:1,openAlerts:0},
      retries:{jobs:1,pending:0,succeeded:1,attempts:1},
      trend:[{month:"2026-09",primaryIntegrityPct:100,replicaIntegrityPct:100,alertsDetected:0,drills:2,drillsSuccessful:2}]
    }
  });
  assert.ok(pdf.length>1000);
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
});
