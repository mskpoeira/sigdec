# SIGDEC v1.27 — Evidências, AAR e ações corretivas de continuidade

## Objetivo

Completar o ciclo dos exercícios de continuidade iniciados na v1.26 com registro
de evidências, After Action Review (AAR), ações corretivas e relatório PDF auditável.

A v1.27 continua sem executar failover real automaticamente.

## Migration

- `0034_sidec_continuity_evidence_aar.sql`

Novas estruturas:

- `sidec_continuity_step_evidence`;
- `sidec_continuity_aars`;
- `sidec_continuity_action_items`.

## Evidências por etapa

Cada etapa de exercício pode receber evidências referenciais dos tipos:

- `NOTE`;
- `LINK`;
- `DOCUMENT`;
- `HASH`.

Campos:

- título;
- referência;
- SHA-256 opcional;
- usuário responsável;
- data/hora.

A v1.27 não faz upload arbitrário de binários. Evidências são referências auditáveis
e podem apontar para documento, link, registro ou hash previamente preservado.

Endpoint:

`POST /api/v1/sidec/continuity/exercises/:exerciseId/steps/:stepId/evidence`

## Controle de exceções

O encerramento continua bloqueado enquanto houver etapa obrigatória pendente.

Além disso, uma etapa obrigatória marcada como:

- `SKIPPED`; ou
- `FAILED`

precisa possuir pelo menos:

- observação registrada na etapa; ou
- evidência referencial.

Caso contrário:

`EVIDENCE_REQUIRED_FOR_EXCEPTION`

Esse controle evita exercícios parciais ou falhos sem justificativa mínima.

## After Action Review

O AAR só pode ser criado para exercício `COMPLETED`.

Campos:

- resumo executivo;
- pontos fortes;
- lacunas;
- recomendações.

Estados:

- `DRAFT`;
- `FINAL`.

Endpoint para salvar rascunho:

`PUT /api/v1/sidec/continuity/exercises/:id/aar`

Finalização:

`POST /api/v1/sidec/continuity/exercises/:id/aar/finalize`

Depois de `FINAL`, o conteúdo textual do AAR é imutável pela API.

## Ações corretivas

Ações do AAR possuem:

- título;
- descrição;
- prioridade;
- responsável;
- prazo;
- status.

Prioridades:

- `LOW`;
- `MEDIUM`;
- `HIGH`;
- `CRITICAL`.

Estados:

- `OPEN`;
- `IN_PROGRESS`;
- `DONE`;
- `CANCELLED`.

Criação:

`POST /api/v1/sidec/continuity/exercises/:id/aar/actions`

Atualização:

`PATCH /api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId`

Antes de finalizar o AAR, toda ação não cancelada precisa possuir:

- responsável nominal;
- prazo.

Após a finalização, título, descrição, prioridade, responsável e prazo ficam
congelados; o status operacional continua atualizável para acompanhamento.

## Relatório PDF

Endpoint:

`GET /api/v1/sidec/continuity/exercises/:id/report.pdf`

O relatório consolida:

- organização;
- versão/título do runbook;
- cenário;
- status e resultado;
- resumo da execução;
- etapas;
- observações;
- evidências;
- AAR;
- ações corretivas;
- nota de governança.

O PDF informa expressamente que o exercício não comprova failover produtivo,
restauração real, alteração de DNS ou qualquer ação destrutiva.

## Centro de Continuidade

A rota:

`/continuidade`

passa a permitir:

- registrar observação na etapa;
- concluir, pular, falhar ou reabrir;
- cadastrar evidência;
- consultar evidências registradas;
- abrir AAR de exercício concluído;
- salvar AAR em rascunho;
- criar ações corretivas;
- acompanhar status das ações;
- finalizar AAR;
- baixar o relatório PDF.

## Imutabilidade e auditoria

São auditados:

- criação de evidência;
- salvamento do AAR;
- criação de ação;
- atualização de ação;
- finalização do AAR.

O conteúdo de um AAR `FINAL` não pode ser reescrito.

## Segurança

- evidência por referência evita upload arbitrário nesta fase;
- SHA-256 opcional permite vincular referência a conteúdo previamente preservado;
- responsáveis precisam pertencer à organização;
- ações abertas precisam de responsável e prazo antes da finalização;
- exercícios e AAR permanecem separados de qualquer mecanismo de failover real.

## Próxima evolução sugerida

- agenda periódica de exercícios;
- contatos externos e matriz de escalonamento;
- vencimento e alertas das ações corretivas;
- dashboard de lições aprendidas recorrentes;
- runbooks técnicos especializados por banco, aplicação, storage e conectividade;
- vínculo opcional das ações corretivas a riscos e projetos de recuperação.
