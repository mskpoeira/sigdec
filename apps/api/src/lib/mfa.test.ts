import assert from "node:assert/strict";
import test from "node:test";
import {
 buildTotpUri,
 decryptMfaSecret,
 encryptMfaSecret,
 generateRecoveryCodes,
 generateTotpCode,
 generateTotpSecret,
 hashRecoveryCode,
 verifyTotp
} from "./mfa.js";

test("TOTP SIGDEC valida codigo atual e rejeita codigo incorreto",()=>{
 const secret="JBSWY3DPEHPK3PXP";
 const at=1760000000000;
 const code=generateTotpCode(secret,at);
 assert.match(code,/^\d{6}$/);
 assert.equal(verifyTotp(secret,code,at),true);
 assert.equal(verifyTotp(secret,code==="000000"?"111111":"000000",at),false);
});

test("segredo MFA criptografado faz roundtrip autenticado",()=>{
 const previous=process.env.MFA_ENCRYPTION_SECRET;
 process.env.MFA_ENCRYPTION_SECRET="0123456789abcdef0123456789abcdef-extra";
 try{
  const secret=generateTotpSecret();
  const encrypted=encryptMfaSecret(secret);
  assert.notEqual(encrypted,secret);
  assert.equal(decryptMfaSecret(encrypted),secret);
 }finally{
  if(previous===undefined)delete process.env.MFA_ENCRYPTION_SECRET;else process.env.MFA_ENCRYPTION_SECRET=previous;
 }
});

test("codigos de recuperacao sao unicos, normalizados e hashaveis",()=>{
 const codes=generateRecoveryCodes(10);
 assert.equal(codes.length,10);
 assert.equal(new Set(codes).size,10);
 assert.ok(codes.every(x=>/^SIGDEC-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(x)));
 assert.equal(hashRecoveryCode(codes[0]),hashRecoveryCode(codes[0].toLowerCase().replaceAll("-"," ")));
});

test("URI TOTP usa issuer e conta SIGDEC",()=>{
 const uri=buildTotpUri({secret:"ABCDEF234567",account:"915789"});
 assert.match(uri,/^otpauth:\/\/totp\//);
 assert.match(uri,/issuer=SIGDEC/);
 assert.match(uri,/digits=6/);
});
