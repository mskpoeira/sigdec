import assert from "node:assert/strict";
import { after,test } from "node:test";
import { createHmac } from "node:crypto";
import { currentSidecSigningKeyId,hashBinary,signSidecManifestHash,signSidecManifestHashVersioned,verifySidecManifestSignature } from "./sidec-signature.js";

const previous={
 secret:process.env.SIDEC_MANIFEST_SIGNING_SECRET,
 keyId:process.env.SIDEC_MANIFEST_SIGNING_KEY_ID,
 keys:process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON
};
process.env.SIDEC_MANIFEST_SIGNING_SECRET="sigdec-test-signing-secret-0123456789abcdef";
delete process.env.SIDEC_MANIFEST_SIGNING_KEY_ID;
delete process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON;

test("assinatura legacy v1.16 permanece verificavel",()=>{
 const hash="a".repeat(64);
 const legacyDerived=createHmac("sha256",process.env.SIDEC_MANIFEST_SIGNING_SECRET!).update("SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1","utf8").digest();
 const legacySignature=createHmac("sha256",legacyDerived).update(hash,"utf8").digest("hex");
 assert.equal(currentSidecSigningKeyId(),"legacy-v1");
 assert.equal(signSidecManifestHash(hash),legacySignature);
 assert.equal(verifySidecManifestSignature(hash,legacySignature,"legacy-v1"),true);
});

test("assinatura versionada seleciona chave por id",()=>{
 process.env.SIDEC_MANIFEST_SIGNING_KEY_ID="2026-q4";
 process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON=JSON.stringify({
  "2026-q4":"key-2026-q4-0123456789-abcdefghijklmnop",
  "2027-q1":"key-2027-q1-0123456789-abcdefghijklmnop"
 });
 const hash="b".repeat(64);
 const signed=signSidecManifestHashVersioned(hash);
 assert.equal(signed.keyId,"2026-q4");
 assert.equal(verifySidecManifestSignature(hash,signed.signature,"2026-q4"),true);
 assert.equal(verifySidecManifestSignature(hash,signed.signature,"2027-q1"),false);
});

test("hash binario SHA-256 e estavel",()=>{
 assert.equal(hashBinary(Buffer.from("SIGDEC")),hashBinary(Buffer.from("SIGDEC")));
 assert.notEqual(hashBinary(Buffer.from("SIGDEC")),hashBinary(Buffer.from("SIDEC")));
});

after(()=>{
 if(previous.secret===undefined)delete process.env.SIDEC_MANIFEST_SIGNING_SECRET;else process.env.SIDEC_MANIFEST_SIGNING_SECRET=previous.secret;
 if(previous.keyId===undefined)delete process.env.SIDEC_MANIFEST_SIGNING_KEY_ID;else process.env.SIDEC_MANIFEST_SIGNING_KEY_ID=previous.keyId;
 if(previous.keys===undefined)delete process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON;else process.env.SIDEC_MANIFEST_SIGNING_KEYS_JSON=previous.keys;
});
