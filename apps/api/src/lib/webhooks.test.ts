import assert from "node:assert/strict";
import test from "node:test";
import {assertSafeWebhookUrl,newWebhookSecret,publicWebhookAddress} from "./webhooks.js";

test("webhook exige HTTPS em produção",async()=>{
 const previous=process.env.NODE_ENV;
 process.env.NODE_ENV="production";
 try{
  await assert.rejects(()=>assertSafeWebhookUrl("http://example.com/hook"),/HTTPS/);
  await assert.rejects(()=>assertSafeWebhookUrl("https://127.0.0.1/hook"),/local|privada/i);
 }finally{
  if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
 }
});

test("segredo de webhook tem entropia adequada",()=>{
 const a=newWebhookSecret(),b=newWebhookSecret();
 assert.notEqual(a,b);
 assert.ok(a.length>=40);
});

test("destinos não públicos e representações IPv6 são bloqueados",()=>{
 for(const address of ["0.0.0.0","10.0.0.1","100.64.1.2","127.0.0.1","169.254.169.254",
  "172.16.0.1","192.0.0.1","192.168.1.1","198.18.0.1","224.0.0.1",
  "::1","fe80::1","fd00::1","::ffff:127.0.0.1","2001:db8::1"]){
  assert.equal(publicWebhookAddress(address),false,address);
 }
 for(const address of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"]){
  assert.equal(publicWebhookAddress(address),true,address);
 }
});
