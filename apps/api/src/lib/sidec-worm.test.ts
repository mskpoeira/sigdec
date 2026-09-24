import assert from "node:assert/strict";
import test from "node:test";
import { wormMode,wormObjectKey,wormReplicaBucket,wormReplicaEnabled,wormReplicaMode } from "./sidec-worm.js";

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


test("configuracao da replica WORM e explicita",()=>{
 const previousEnabled=process.env.SIDEC_WORM_REPLICA_ENABLED;
 const previousBucket=process.env.SIDEC_WORM_REPLICA_BUCKET;
 const previousMode=process.env.SIDEC_WORM_REPLICA_MODE;
 process.env.SIDEC_WORM_REPLICA_ENABLED="true";
 process.env.SIDEC_WORM_REPLICA_BUCKET="sigdec-replica-test";
 process.env.SIDEC_WORM_REPLICA_MODE="COMPLIANCE";
 assert.equal(wormReplicaEnabled(),true);
 assert.equal(wormReplicaBucket(),"sigdec-replica-test");
 assert.equal(wormReplicaMode(),"COMPLIANCE");
 if(previousEnabled===undefined)delete process.env.SIDEC_WORM_REPLICA_ENABLED;else process.env.SIDEC_WORM_REPLICA_ENABLED=previousEnabled;
 if(previousBucket===undefined)delete process.env.SIDEC_WORM_REPLICA_BUCKET;else process.env.SIDEC_WORM_REPLICA_BUCKET=previousBucket;
 if(previousMode===undefined)delete process.env.SIDEC_WORM_REPLICA_MODE;else process.env.SIDEC_WORM_REPLICA_MODE=previousMode;
});
