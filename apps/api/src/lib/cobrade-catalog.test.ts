import assert from "node:assert/strict";
import test from "node:test";
import { parseCobradeCatalogCsv } from "./cobrade-catalog.js";

test("importa CSV COBRADE separado por ponto e virgula",()=>{
 const items=parseCobradeCatalogCsv("codigo;nome;grupo\n1.2.3.4.5;Evento exemplo;Grupo A");
 assert.equal(items.length,1);assert.equal(items[0]?.code,"1.2.3.4.5");assert.equal(items[0]?.name,"Evento exemplo");
});

test("aceita cabecalhos alternativos",()=>{
 const items=parseCobradeCatalogCsv("cobrade,descricao\n999,Evento");
 assert.equal(items[0]?.code,"999");
});

test("rejeita codigo duplicado",()=>{
 assert.throws(()=>parseCobradeCatalogCsv("codigo;nome\n1;A\n1;B"),/COBRADE_CSV_DUPLICATE/);
});
