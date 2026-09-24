import assert from "node:assert/strict";
import test from "node:test";
import { wormMode,wormObjectKey } from "./sidec-worm.js";

test("chave WORM deriva somente do SHA-256",()=>{
 const hash="a".repeat(64);
 assert.equal(wormObjectKey(hash),`sidec/aa/${hash}.zip`);
 assert.throws(()=>wormObjectKey("abc"));
});

test("modo WORM aceita apenas governance ou compliance",()=>{
 const previous=process.env.SIDEC_WORM_MODE;
 process.env.SIDEC_WORM_MODE="COMPLIANCE";
 assert.equal(wormMode(),"COMPLIANCE");
 process.env.SIDEC_WORM_MODE="GOVERNANCE";
 assert.equal(wormMode(),"GOVERNANCE");
 process.env.SIDEC_WORM_MODE="INVALID";
 assert.throws(()=>wormMode());
 if(previous===undefined)delete process.env.SIDEC_WORM_MODE;else process.env.SIDEC_WORM_MODE=previous;
});
