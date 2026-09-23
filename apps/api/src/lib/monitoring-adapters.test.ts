import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMonitoringPayload } from "./monitoring-adapters.js";

test("normaliza payload generico",()=>{
 const r=normalizeMonitoringPayload("SIGDEC_GENERIC_V1",{measuredAt:"2026-09-23T12:00:00-03:00",metric:"chuva_1h",value:12.5,unit:"mm"});
 assert.equal(r.metric,"chuva_1h");assert.equal(r.value,12.5);assert.equal(r.adapter,"SIGDEC_GENERIC_V1");
});

test("normaliza bridge GeoPixel",()=>{
 const r=normalizeMonitoringPayload("GEOPIXEL_BRIDGE_V1",{timestamp:"2026-09-23T12:00:00-03:00",metric:"chuva_1h",reading:42.2,unit:"mm",externalStationId:"UBT-01"});
 assert.equal(r.value,42.2);assert.equal(r.externalStationId,"UBT-01");assert.equal(r.adapter,"GEOPIXEL_BRIDGE_V1");
});

test("rejeita adaptador desconhecido",()=>{
 assert.throws(()=>normalizeMonitoringPayload("OUTRO",{}),/UNSUPPORTED_MONITORING_ADAPTER/);
});
