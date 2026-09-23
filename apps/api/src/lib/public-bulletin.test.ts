import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicBulletinContent } from "./public-bulletin.js";

test("gera boletim somente com dados agregados e monitoramento",()=>{
 const text=buildPublicBulletinContent({generatedAt:"2026-09-23T18:00:00-03:00",summary:{activeIncidents:3,publishedAlerts:1,openShelters:2,openMonitoringEvents:4,emergencyMonitoringEvents:1},monitoringEvents:[{severity:"WARNING",stationName:"Estação Norte",title:"Chuva intensa"}]});
 assert.match(text,/Ocorrências em atendimento: 3/);
 assert.match(text,/Estação Norte/);
 assert.doesNotMatch(text,/CPF|telefone|responsável/i);
});
