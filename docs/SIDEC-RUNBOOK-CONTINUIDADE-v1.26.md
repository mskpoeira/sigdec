# SIGDEC v1.26 — Plano de Continuidade e Runbook SIDEC

## Objetivo

Adicionar uma camada operacional versionada para continuidade do SIDEC, conectada às metas administrativas de RPO/RTO da v1.25.

A v1.26 organiza responsáveis, fases, critérios de ativação e exercícios de mesa sem executar failover real automaticamente.

## Migration

- `0033_sidec_continuity_runbook.sql`

Novas estruturas:

- `sidec_continuity_plans`;
- `sidec_continuity_steps`;
- `sidec_continuity_exercises`;
- `sidec_continuity_exercise_steps`.

## Versionamento do plano

Cada organização pode possuir:

- uma revisão `ACTIVE`;
- uma revisão `DRAFT`;
- múltiplas revisões `RETIRED`.

Revisões ativas e aposentadas são tratadas como imutáveis pela API. Mudanças operacionais exigem uma nova revisão.

## Fases obrigatórias

O runbook possui seis fases controladas:

1. `DECLARATION` — declaração da contingência;
2. `COMMUNICATION` — acionamento e coordenação;
3. `PRESERVATION` — preservação de evidências e dados;
4. `RECOVERY` — recuperação controlada;
5. `VALIDATION` — validação técnica e funcional;
6. `RETURN` — retorno à normalidade.

Cada etapa registra:

- ordem;
- título;
- instruções;
- tempo esperado;
- responsável nominal;
- obrigatoriedade.

A ativação exige conteúdo mínimo, todas as fases obrigatórias e responsável nominal nas etapas obrigatórias.

## API

### Consultar runbook

`GET /api/v1/sidec/continuity/runbook`

Retorna:

- revisão ativa;
- rascunho;
- histórico de revisões;
- operadores da organização disponíveis para atribuição.

### Criar nova revisão

`POST /api/v1/sidec/continuity/runbook/revisions`

Pode clonar a revisão ativa. Quando não existe revisão ativa, o SIGDEC cria um template inicial com as seis fases.

### Atualizar rascunho

`PUT /api/v1/sidec/continuity/runbook/:id`

Somente revisões `DRAFT` são editáveis.

### Ativar revisão

`POST /api/v1/sidec/continuity/runbook/:id/activate`

A revisão somente é ativada se passar pela validação estrutural. A revisão ativa anterior é preservada como `RETIRED`.

## Exercícios de mesa

### Consultar

`GET /api/v1/sidec/continuity/exercises`

### Iniciar

`POST /api/v1/sidec/continuity/exercises`

Requer um runbook ativo. Somente um exercício pode permanecer em andamento por organização.

### Atualizar etapa

`PATCH /api/v1/sidec/continuity/exercises/:exerciseId/steps/:stepId`

Estados:

- `PENDING`;
- `COMPLETED`;
- `SKIPPED`;
- `FAILED`.

### Encerrar

`POST /api/v1/sidec/continuity/exercises/:id/finish`

O encerramento é bloqueado enquanto houver etapa obrigatória pendente.

Resultado calculado:

- `PASS`: todas as etapas obrigatórias concluídas;
- `PARTIAL`: houve etapa obrigatória pulada;
- `FAIL`: houve falha em etapa obrigatória.

### Cancelar

`POST /api/v1/sidec/continuity/exercises/:id/cancel`

O cancelamento também gera trilha de auditoria.

## Centro de Continuidade

Nova rota web:

- `/continuidade`

A tela permite:

- visualizar revisão ativa;
- criar nova revisão;
- editar rascunho;
- definir responsáveis;
- validar e ativar;
- iniciar exercícios de mesa;
- registrar conclusão, salto ou falha de cada etapa;
- reabrir etapa;
- encerrar ou cancelar exercício;
- consultar histórico de versões e exercícios.

O Centro de Gestão possui link direto para essa tela.

## Permissões

Novas permissões:

- `sidec_continuity.read`;
- `sidec_continuity.manage`.

O perfil `MASTER` recebe ambas na migration.

## Auditoria

São auditados:

- criação de revisão;
- edição de rascunho;
- ativação;
- início de exercício;
- atualização de etapa;
- encerramento;
- cancelamento.

## Controles de segurança

A v1.26 não:

- executa failover real;
- altera DNS;
- troca storage ativo;
- restaura banco automaticamente;
- remove retenção WORM;
- remove legal hold;
- destrói ou substitui infraestrutura;
- transforma exercício de mesa em ação operacional real.

Qualquer ação de recuperação real deve continuar sendo autorizada e executada por procedimento técnico específico.

## Próxima evolução sugerida

- geração de relatório PDF do exercício;
- evidências anexadas por etapa;
- contatos externos e escalonamento;
- agenda de exercícios periódicos;
- avaliação formal de lições aprendidas;
- runbook específico para banco, aplicação, storage e conectividade.
