import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSidecRunbookSteps, summarizeSidecContinuityExercise, validateSidecRunbookActivation } from "./sidec-runbook.js";

test("template padrão cobre todas as fases obrigatórias",()=>{
 const steps=defaultSidecRunbookSteps("00000000-0000-0000-0000-000000000001");
 assert.equal(steps.length,6);
 assert.equal(new Set(steps.map(x=>x.phase)).size,6);
 assert.ok(steps.every(x=>x.required&&x.ownerUserId));
});

test("ativação exige conteúdo e responsável nominal",()=>{
 const steps=defaultSidecRunbookSteps(null);
 const result=validateSidecRunbookActivation({
  title:"Plano de Continuidade SIDEC",
  activationCriteria:"Ativar diante de indisponibilidade relevante confirmada do serviço ou dos artefatos.",
  recoveryStrategy:"Restaurar artefatos somente em ambiente autorizado e validar a integridade antes do uso.",
  communicationPlan:"Acionar responsáveis formais e registrar os canais alternativos usados durante a contingência.",
  returnToNormal:"Retornar apenas após validação técnica, registro das pendências e comunicação do encerramento.",
  steps
 });
 assert.equal(result.valid,false);
 assert.ok(result.errors.some(x=>x.includes("responsável nominal")));
});

test("ativação aprova runbook completo",()=>{
 const result=validateSidecRunbookActivation({
  title:"Plano de Continuidade SIDEC",
  activationCriteria:"Ativar diante de indisponibilidade relevante confirmada do serviço ou dos artefatos.",
  recoveryStrategy:"Restaurar artefatos somente em ambiente autorizado e validar a integridade antes do uso.",
  communicationPlan:"Acionar responsáveis formais e registrar os canais alternativos usados durante a contingência.",
  returnToNormal:"Retornar apenas após validação técnica, registro das pendências e comunicação do encerramento.",
  steps:defaultSidecRunbookSteps("00000000-0000-0000-0000-000000000001")
 });
 assert.equal(result.valid,true);
 assert.deepEqual(result.errors,[]);
});

test("resumo de exercício diferencia sucesso parcial e falha",()=>{
 assert.equal(summarizeSidecContinuityExercise([
  {required:true,status:"COMPLETED"},
  {required:true,status:"COMPLETED"}
 ]).result,"PASS");
 assert.equal(summarizeSidecContinuityExercise([
  {required:true,status:"COMPLETED"},
  {required:true,status:"SKIPPED"}
 ]).result,"PARTIAL");
 assert.equal(summarizeSidecContinuityExercise([
  {required:true,status:"FAILED"},
  {required:true,status:"COMPLETED"}
 ]).result,"FAIL");
 assert.equal(summarizeSidecContinuityExercise([
  {required:true,status:"PENDING"}
 ]).result,null);
});
