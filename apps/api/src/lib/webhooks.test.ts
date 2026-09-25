import assert from "node:assert/strict";
import test from "node:test";
import {assertSafeWebhookUrl,newWebhookSecret} from "./webhooks.js";

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
