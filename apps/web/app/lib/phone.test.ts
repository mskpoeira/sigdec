import test from"node:test";import assert from"node:assert/strict";import{detectPhoneKind,formatBrPhone,normalizedBrPhone}from"./phone";
test("detecta fixo por DDD + 8 dígitos",()=>assert.equal(detectPhoneKind("(12) 3333-4444"),"LANDLINE"));
test("detecta celular por DDD + 9 dígitos",()=>assert.equal(detectPhoneKind("(12) 99999-8888"),"MOBILE"));
test("não classifica número incompleto",()=>assert.equal(detectPhoneKind("(12) 9999"),null));
test("aplica máscara de fixo",()=>assert.equal(formatBrPhone("1233334444"),"(12) 3333-4444"));
test("aplica máscara de celular",()=>assert.equal(formatBrPhone("12999998888"),"(12) 99999-8888"));
test("normaliza somente número completo",()=>{assert.equal(normalizedBrPhone("(12) 99999-8888"),"12999998888");assert.equal(normalizedBrPhone("12999"),null)});
