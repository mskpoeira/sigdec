import assert from "node:assert/strict";
import test from "node:test";
import { hasZipSignature,nextResilienceRetryAt,resilienceBackoffMinutes,shouldAlertResilience } from "./sidec-resilience.js";

test("backoff exponencial possui teto",()=>{
 assert.equal(resilienceBackoffMinutes(0),15);
 assert.equal(resilienceBackoffMinutes(1),30);
 assert.equal(resilienceBackoffMinutes(4),240);
 assert.equal(resilienceBackoffMinutes(20),1440);
});

test("proximo retry deriva do numero de tentativas",()=>{
 const now=new Date("2026-09-24T00:00:00Z");
 assert.equal(nextResilienceRetryAt(2,now).toISOString(),"2026-09-24T01:00:00.000Z");
});

test("assinatura ZIP reconhece headers PK validos",()=>{
 assert.equal(hasZipSignature(Buffer.from([0x50,0x4b,0x03,0x04,0x00])),true);
 assert.equal(hasZipSignature(Buffer.from([0x50,0x4b,0x05,0x06])),true);
 assert.equal(hasZipSignature(Buffer.from("NOTZIP")),false);
});

test("alerta exige degradacao persistente",()=>{
 const first=new Date("2026-09-24T00:00:00Z");
 assert.equal(shouldAlertResilience(first,6,new Date("2026-09-24T05:59:59Z")),false);
 assert.equal(shouldAlertResilience(first,6,new Date("2026-09-24T06:00:00Z")),true);
});
