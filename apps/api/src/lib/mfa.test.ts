import assert from "node:assert/strict";
import test from "node:test";
import {decryptTotpSecret,encryptTotpSecret,generateTotpSecret,recoveryCode,recoveryCodeHash,totpCode,verifyTotp} from "./mfa.js";

process.env.JWT_SECRET ||= "sigdec-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789";

test("TOTP SIGDEC gera e valida código de 6 dígitos",()=>{
 const secret=generateTotpSecret();
 const at=Date.UTC(2026,8,25,3,0,0);
 const code=totpCode(secret,at);
 assert.match(code,/^\d{6}$/);
 assert.equal(verifyTotp(secret,code,at),true);
 assert.equal(verifyTotp(secret,"000000",at),code==="000000");
});

test("segredo TOTP fica cifrado em repouso",()=>{
 const secret=generateTotpSecret();
 const encrypted=encryptTotpSecret(secret);
 assert.notEqual(encrypted,secret);
 assert.equal(decryptTotpSecret(encrypted),secret);
});

test("códigos de recuperação são formatados e hasháveis",()=>{
 const code=recoveryCode();
 assert.match(code,/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
 assert.equal(recoveryCodeHash(code),recoveryCodeHash(code.toLowerCase()));
});
