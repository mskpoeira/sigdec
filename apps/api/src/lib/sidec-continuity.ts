export type ContinuityState="COMPLIANT"|"BREACH"|"INSUFFICIENT_DATA"|"DISABLED";

export type SidecContinuityPolicy={
  enabled:boolean;
  rpoMinutes:number;
  rtoMinutes:number;
  drillMaxAgeHours:number;
};

export type SidecContinuityMetrics={
  archives:number;
  replicas:number;
  missingReplicas:number;
  maxReplicationDelayMinutes:number|null;
  latestSuccessfulDrillAt:Date|null;
  latestSuccessfulDrillDurationMinutes:number|null;
};

export type SidecContinuityReadiness={
  overall:ContinuityState;
  rpo:{state:ContinuityState;objectiveMinutes:number;observedMinutes:number|null;reason:string};
  rto:{state:ContinuityState;objectiveMinutes:number;observedMinutes:number|null;reason:string};
  drillFreshness:{state:ContinuityState;maxAgeHours:number;ageHours:number|null;reason:string};
};

function hoursBetween(from:Date,to:Date){
  return Math.max(0,(to.getTime()-from.getTime())/(60*60*1000));
}

export function evaluateSidecContinuity(
  policy:SidecContinuityPolicy,
  metrics:SidecContinuityMetrics,
  now=new Date()
):SidecContinuityReadiness{
  if(!policy.enabled){
    const disabled:ContinuityState="DISABLED";
    return {
      overall:disabled,
      rpo:{state:disabled,objectiveMinutes:policy.rpoMinutes,observedMinutes:null,reason:"Política administrativa de continuidade desabilitada."},
      rto:{state:disabled,objectiveMinutes:policy.rtoMinutes,observedMinutes:null,reason:"Política administrativa de continuidade desabilitada."},
      drillFreshness:{state:disabled,maxAgeHours:policy.drillMaxAgeHours,ageHours:null,reason:"Política administrativa de continuidade desabilitada."}
    };
  }

  let rpoState:ContinuityState;
  let rpoReason:string;
  if(metrics.archives===0){
    rpoState="INSUFFICIENT_DATA";
    rpoReason="Ainda não há arquivos WORM para avaliar o objetivo de replicação.";
  }else if(metrics.missingReplicas>0){
    rpoState="BREACH";
    rpoReason=`${metrics.missingReplicas} arquivo(s) WORM ainda não possuem réplica.`;
  }else if(metrics.maxReplicationDelayMinutes===null){
    rpoState="INSUFFICIENT_DATA";
    rpoReason="Não há atraso de replicação mensurável registrado.";
  }else if(metrics.maxReplicationDelayMinutes<=policy.rpoMinutes){
    rpoState="COMPLIANT";
    rpoReason="O maior atraso observado de replicação está dentro do objetivo administrativo.";
  }else{
    rpoState="BREACH";
    rpoReason="O maior atraso observado de replicação excede o objetivo administrativo.";
  }

  const drillAgeHours=metrics.latestSuccessfulDrillAt?hoursBetween(metrics.latestSuccessfulDrillAt,now):null;
  let drillState:ContinuityState;
  let drillReason:string;
  if(!metrics.latestSuccessfulDrillAt){
    drillState="INSUFFICIENT_DATA";
    drillReason="Nenhum drill de restauração bem-sucedido foi registrado.";
  }else if((drillAgeHours??Infinity)<=policy.drillMaxAgeHours){
    drillState="COMPLIANT";
    drillReason="Existe evidência recente de restauração bem-sucedida.";
  }else{
    drillState="BREACH";
    drillReason="A última evidência de restauração bem-sucedida está vencida.";
  }

  let rtoState:ContinuityState;
  let rtoReason:string;
  if(metrics.latestSuccessfulDrillDurationMinutes===null){
    rtoState="INSUFFICIENT_DATA";
    rtoReason="Não há duração de drill bem-sucedido disponível para comparação.";
  }else if(metrics.latestSuccessfulDrillDurationMinutes<=policy.rtoMinutes){
    rtoState="COMPLIANT";
    rtoReason="A duração do último drill está dentro do objetivo administrativo de recuperação.";
  }else{
    rtoState="BREACH";
    rtoReason="A duração do último drill excede o objetivo administrativo de recuperação.";
  }

  const states=[rpoState,rtoState,drillState];
  const overall:ContinuityState=states.includes("BREACH")
    ?"BREACH"
    :states.includes("INSUFFICIENT_DATA")
      ?"INSUFFICIENT_DATA"
      :"COMPLIANT";

  return {
    overall,
    rpo:{
      state:rpoState,
      objectiveMinutes:policy.rpoMinutes,
      observedMinutes:metrics.maxReplicationDelayMinutes,
      reason:rpoReason
    },
    rto:{
      state:rtoState,
      objectiveMinutes:policy.rtoMinutes,
      observedMinutes:metrics.latestSuccessfulDrillDurationMinutes,
      reason:rtoReason
    },
    drillFreshness:{
      state:drillState,
      maxAgeHours:policy.drillMaxAgeHours,
      ageHours:drillAgeHours===null?null:Math.round(drillAgeHours*100)/100,
      reason:drillReason
    }
  };
}
