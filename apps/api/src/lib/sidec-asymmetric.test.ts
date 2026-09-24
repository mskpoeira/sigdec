import assert from "node:assert/strict";
import { after,test } from "node:test";
import { signSidecIntegrity,signSidecTimestamp,verifySidecIntegrity,verifySidecTimestamp } from "./sidec-asymmetric.js";

const previousSeed=process.env.SIDEC_ED25519_PRIVATE_SEED_BASE64;
const previousId=process.env.SIDEC_ED25519_KEY_ID;
process.env.SIDEC_ED25519_PRIVATE_SEED_BASE64=Buffer.alloc(32,7).toString("base64");
process.env.SIDEC_ED25519_KEY_ID="test-ed25519";

test("Ed25519 vincula manifesto e ZIP selado",()=>{
 const signed=signSidecIntegrity("a".repeat(64),"b".repeat(64));
 assert.equal(signed.algorithm,"Ed25519");
 assert.equal(signed.keyId,"test-ed25519");
 assert.equal(signed.publicKeyFingerprint.length,64);
 assert.equal(verifySidecIntegrity({
  manifestHash:"a".repeat(64),artifactHash:"b".repeat(64),
  signature:signed.signature,publicKey:signed.publicKey,publicKeyFingerprint:signed.publicKeyFingerprint
 }),true);
 assert.equal(verifySidecIntegrity({
  manifestHash:"a".repeat(64),artifactHash:"c".repeat(64),
  signature:signed.signature,publicKey:signed.publicKey,publicKeyFingerprint:signed.publicKeyFingerprint
 }),false);
});

test("fingerprint adulterado invalida comprovante",()=>{
 const signed=signSidecIntegrity("c".repeat(64),"d".repeat(64));
 assert.equal(verifySidecIntegrity({
  manifestHash:"c".repeat(64),artifactHash:"d".repeat(64),
  signature:signed.signature,publicKey:signed.publicKey,publicKeyFingerprint:"0".repeat(64)
 }),false);
});

after(()=>{
 if(previousSeed===undefined)delete process.env.SIDEC_ED25519_PRIVATE_SEED_BASE64;else process.env.SIDEC_ED25519_PRIVATE_SEED_BASE64=previousSeed;
 if(previousId===undefined)delete process.env.SIDEC_ED25519_KEY_ID;else process.env.SIDEC_ED25519_KEY_ID=previousId;
});


test("carimbo interno vincula hashes atestacao e instante",()=>{
 const attestation=signSidecIntegrity("e".repeat(64),"f".repeat(64));
 const timestampedAt="2026-09-23T23:00:00.000Z";
 const timestamp=signSidecTimestamp({
  manifestHash:"e".repeat(64),
  artifactHash:"f".repeat(64),
  attestationSignature:attestation.signature,
  timestampedAt
 });
 assert.equal(timestamp.statementHash.length,64);
 assert.equal(verifySidecTimestamp({
  manifestHash:"e".repeat(64),
  artifactHash:"f".repeat(64),
  attestationSignature:attestation.signature,
  timestampedAt,
  statementHash:timestamp.statementHash,
  signature:timestamp.signature,
  publicKey:timestamp.publicKey,
  publicKeyFingerprint:timestamp.publicKeyFingerprint
 }),true);
 assert.equal(verifySidecTimestamp({
  manifestHash:"e".repeat(64),
  artifactHash:"f".repeat(64),
  attestationSignature:attestation.signature,
  timestampedAt:"2026-09-23T23:01:00.000Z",
  statementHash:timestamp.statementHash,
  signature:timestamp.signature,
  publicKey:timestamp.publicKey,
  publicKeyFingerprint:timestamp.publicKeyFingerprint
 }),false);
});
