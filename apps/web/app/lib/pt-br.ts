export const ptBRLabels:Record<string,string>={
  // Ocorrências e despacho
  RECEIVED:"Recebida",TRIAGE:"Em triagem",WAITING_DISPATCH:"Aguardando despacho",DISPATCHED:"Despachada",
  ACKNOWLEDGED:"Ciente",EN_ROUTE:"Em deslocamento",ON_SCENE:"No local",IN_SERVICE:"Em atendimento",
  WAITING_SUPPORT:"Aguardando apoio",INSPECTION:"Em vistoria",MONITORING:"Em monitoramento",
  COMPLETED:"Concluída",CLOSED:"Encerrada",CANCELLED:"Cancelada",DUPLICATE:"Duplicada",RELEASED:"Liberada",

  // Situações gerais
  ACTIVE:"Ativo",INACTIVE:"Inativo",OPEN:"Aberto",STANDBY:"Em prontidão",READY:"Pronto",
  PENDING:"Pendente",PROCESSING:"Processando",SUCCEEDED:"Concluído",FAILED:"Falhou",
  ENABLED:"Habilitado",DISABLED:"Desabilitado",AVAILABLE:"Disponível",UNAVAILABLE:"Indisponível",
  OPERATIONAL:"Operacional",DEGRADED:"Degradado",INTERRUPTED:"Interrompido",RESTORED:"Restabelecido",
  RESTRICTED:"Restrito",MAINTENANCE:"Em manutenção",UNKNOWN:"Desconhecido",
  SCHEDULED:"Agendado",IN_PROGRESS:"Em andamento",PAUSED:"Pausado",FINISHED:"Finalizado",
  RETIRED:"Desativado",EXPIRED:"Expirado",VALID:"Válido",INVALID:"Inválido",

  // Documentos, fluxos e aprovação
  DRAFT:"Rascunho",DOCUMENTING:"Em documentação",SUBMITTED:"Enviado",UNDER_REVIEW:"Em análise",
  IN_REVIEW:"Em revisão",RECOGNIZED:"Reconhecido",APPROVED:"Aprovado",REJECTED:"Rejeitado",
  ACCEPTED:"Aceito",RESPONDED:"Respondido",PUBLISHED:"Publicado",ARCHIVED:"Arquivado",
  LINKED:"Vinculado",PROPOSED:"Proposto",APPLIED:"Aplicado",VERIFIED:"Verificado",

  // Severidade / prioridade
  INFO:"Informação",WATCH:"Atenção",WARNING:"Alerta",EMERGENCY:"Emergência",
  LOW:"Baixa",MEDIUM:"Média",HIGH:"Alta",CRITICAL:"Crítica",NORMAL:"Normal",ROUTINE:"Rotina",
  P1:"P1 · Crítica",P2:"P2 · Muito alta",P3:"P3 · Alta",P4:"P4 · Normal",P5:"P5 · Programada",

  // Risco
  R1:"R1 · Baixo",R2:"R2 · Médio",R3:"R3 · Alto",R4:"R4 · Muito alto",

  // Assistência / população
  DISPLACED:"Desalojado",HOMELESS:"Desabrigado",RETURNED:"Retornado",TRANSFERRED:"Transferido",
  RESCUED:"Resgatado",SHELTERED:"Abrigado",VETERINARY:"Atendimento veterinário",DECEASED:"Óbito",
  STABLE:"Estável",INJURED:"Ferido",

  // IA / auditoria
  FALLBACK:"Modo alternativo",ACCEPTED_BY_HUMAN:"Aceito por revisão humana",CORRECTED:"Corrigido",
  ACCEPTED_HUMAN:"Aceito",REJECTED_HUMAN:"Rejeitado",

  // Continuidade / exercícios
  PASS:"Aprovado",FAIL:"Reprovado",PARTIAL:"Parcial",EFFECTIVE:"Eficaz",INEFFECTIVE:"Ineficaz",
  NOT_EVALUATED:"Não avaliado",OVERDUE:"Vencido",

  // Tipos e direções de integração
  IMPORT:"Importação",EXPORT:"Exportação",BIDIRECTIONAL:"Bidirecional",API:"API",WEBHOOK:"Webhook"
};

export function ptBR(value:unknown,fallback?:string){
  if(value===null||value===undefined||value==="")return fallback??"—";
  const raw=String(value);
  return ptBRLabels[raw]??fallback??raw.replaceAll("_"," ").toLowerCase().replace(/(^|\s)\p{L}/gu,m=>m.toUpperCase());
}

export function ptBRList(values:unknown[]){
  return values.map(value=>ptBR(value)).join(" · ");
}
