export const sidecRunbookPhases=[
 "DECLARATION","COMMUNICATION","PRESERVATION","RECOVERY","VALIDATION","RETURN"
] as const;

export type SidecRunbookPhase=typeof sidecRunbookPhases[number];

export type RunbookStepForValidation={
 phase:string;
 title:string;
 instructions:string;
 ownerUserId?:string|null;
 required:boolean;
};

export type RunbookPlanForValidation={
 title:string;
 activationCriteria:string;
 recoveryStrategy:string;
 communicationPlan:string;
 returnToNormal:string;
 steps:RunbookStepForValidation[];
};

export function defaultSidecRunbookSteps(ownerUserId?:string|null){
 const owner=ownerUserId??null;
 return [
  {phase:"DECLARATION" as const,sortOrder:100,title:"Declarar situação de continuidade",instructions:"Confirmar o impacto, registrar o horário de declaração e autorizar o início do runbook sem executar ações destrutivas automaticamente.",expectedMinutes:10,ownerUserId:owner,required:true},
  {phase:"COMMUNICATION" as const,sortOrder:200,title:"Acionar responsáveis e canais alternativos",instructions:"Comunicar a equipe responsável, registrar indisponibilidades e confirmar canal alternativo de coordenação.",expectedMinutes:15,ownerUserId:owner,required:true},
  {phase:"PRESERVATION" as const,sortOrder:300,title:"Preservar evidências e dados íntegros",instructions:"Confirmar integridade WORM, retenção, legal hold quando aplicável e disponibilidade das réplicas antes de qualquer recuperação.",expectedMinutes:20,ownerUserId:owner,required:true},
  {phase:"RECOVERY" as const,sortOrder:400,title:"Executar recuperação controlada",instructions:"Seguir o procedimento técnico aprovado para restauração em ambiente autorizado. Registrar origem, destino, horários e responsáveis.",expectedMinutes:60,ownerUserId:owner,required:true},
  {phase:"VALIDATION" as const,sortOrder:500,title:"Validar integridade e funcionalidade",instructions:"Validar hashes, acesso aos artefatos, funções essenciais e evidências do exercício antes de declarar recuperação concluída.",expectedMinutes:30,ownerUserId:owner,required:true},
  {phase:"RETURN" as const,sortOrder:600,title:"Retornar à operação normal",instructions:"Autorizar retorno à normalidade, registrar pendências, comunicar encerramento e preservar o relatório do exercício.",expectedMinutes:20,ownerUserId:owner,required:true}
 ];
}

export function validateSidecRunbookActivation(plan:RunbookPlanForValidation){
 const errors:string[]=[];
 if(plan.title.trim().length<5)errors.push("Título do plano insuficiente.");
 if(plan.activationCriteria.trim().length<20)errors.push("Critérios de ativação devem ser detalhados.");
 if(plan.recoveryStrategy.trim().length<20)errors.push("Estratégia de recuperação deve ser detalhada.");
 if(plan.communicationPlan.trim().length<20)errors.push("Plano de comunicação deve ser detalhado.");
 if(plan.returnToNormal.trim().length<20)errors.push("Critérios de retorno à normalidade devem ser detalhados.");

 for(const phase of sidecRunbookPhases){
  if(!plan.steps.some(step=>step.phase===phase&&step.required)){
   errors.push(`Fase obrigatória ausente: ${phase}.`);
  }
 }
 const required=plan.steps.filter(step=>step.required);
 if(required.some(step=>!step.ownerUserId)){
  errors.push("Todas as etapas obrigatórias precisam de responsável nominal.");
 }
 if(required.some(step=>step.title.trim().length<3||step.instructions.trim().length<10)){
  errors.push("Etapas obrigatórias precisam de título e instruções suficientes.");
 }
 return {valid:errors.length===0,errors};
}

export type ExerciseStepState={required:boolean;status:"PENDING"|"COMPLETED"|"SKIPPED"|"FAILED"};

export function summarizeSidecContinuityExercise(steps:ExerciseStepState[]){
 const total=steps.length;
 const completed=steps.filter(x=>x.status==="COMPLETED").length;
 const skipped=steps.filter(x=>x.status==="SKIPPED").length;
 const failed=steps.filter(x=>x.status==="FAILED").length;
 const pending=steps.filter(x=>x.status==="PENDING").length;
 const requiredPending=steps.filter(x=>x.required&&x.status==="PENDING").length;
 const requiredSkipped=steps.filter(x=>x.required&&x.status==="SKIPPED").length;
 const requiredFailed=steps.filter(x=>x.required&&x.status==="FAILED").length;
 const result=requiredFailed>0?"FAIL":requiredSkipped>0?"PARTIAL":requiredPending>0?null:"PASS";
 const progressPct=total?Math.round(((completed+skipped+failed)/total)*10000)/100:0;
 return {total,completed,skipped,failed,pending,requiredPending,requiredSkipped,requiredFailed,result,progressPct};
}
