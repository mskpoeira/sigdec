import assert from "node:assert/strict";
import { after,test } from "node:test";
import { hashBinary,signSidecManifestHash,verifySidecManifestSignature } from "./sidec-signature.js";

const previous=process.env.SIDEC_MANIFEST_SIGNING_SECRET;
process.env.SIDEC_MANIFEST_SIGNING_SECRET="sigdec-test-signing-secret-0123456789abcdef";

test("assinatura do manifesto e verificavel",()=>{
 const hash="a".repeat(64);
 const signature=signSidecManifestHash(hash);
 assert.equal(signature.length,64);
 assert.equal(verifySidecManifestSignature(hash,signature),true);
 assert.equal(verifySidecManifestSignature("b".repeat(64),signature),false);
});

test("hash binario SHA-256 e estavel",()=>{
 assert.equal(hashBinary(Buffer.from("SIGDEC")),hashBinary(Buffer.from("SIGDEC")));
 assert.notEqual(hashBinary(Buffer.from("SIGDEC")),hashBinary(Buffer.from("SIDEC")));
});

after(()=>{
 if(previous===undefined)delete process.env.SIDEC_MANIFEST_SIGNING_SECRET;
 else process.env.SIDEC_MANIFEST_SIGNING_SECRET=previous;
});
