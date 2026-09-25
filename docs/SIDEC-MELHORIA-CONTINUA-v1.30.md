# SIGDEC v1.30 — Ciclo de melhoria contínua da continuidade

## Objetivo

Fechar o ciclo entre exercícios de continuidade, AARs, ações corretivas, eficácia observada,
recorrência de lições, recuperação operacional e revisão controlada do runbook.

A v1.30 acrescenta:

- chave estruturada de recorrência em ações corretivas;
- histórico de eficácia agrupado por recorrência;
- promoção humana explícita de ação corretiva para ação de recuperação;
- rastreabilidade da origem da ação de recuperação;
- recomendações estruturadas de revisão do runbook;
- atualização controlada do estado dessas recomendações;
- geração de recomendação somente após recorrência em AARs finalizados;
- interface operacional para aceitar, implementar ou descartar recomendações;
- interface de promoção para recuperação;
- métricas de eficácia por chave de recorrência.

## Migration

- `0037_sidec_continuity_improvement_loop.sql`

Alterações:

- `sidec_continuity_action_items.recurrence_key`;
- `recovery_actions.source_continuity_action_id`;
- tabela `sidec_continuity_runbook_recommendations`;
- permissão `sidec_continuity_improvement.manage`.

## Chave de recorrência

Formato:

`^[a-z0-9][a-z0-9._-]*$`

Exemplos:

- `storage.replica-indisponivel`;
- `contato.desatualizado`;
- `runbook.instrucao-incompleta`.

A chave pode ser informada na ação corretiva e é usada para comparar o comportamento
da mesma causa ou controle ao longo de diferentes exercícios.

## Histórico de eficácia

Endpoint:

`GET /api/v1/sidec/continuity/actions/effectiveness-history`

Agrupa ações por `recurrence_key` e apresenta:

- exercício;
- versão do runbook;
- situação da ação;
- eficácia;
- fundamentação;
- data da avaliação.

A eficácia continua sendo registrada por uma pessoa.

O SIGDEC não conclui automaticamente que uma medida foi eficaz ou ineficaz.

## Métricas por recorrência

O endpoint de métricas passa a retornar `byRecurrenceKey`, incluindo:

- quantidade de ações;
- quantidade de exercícios;
- ações eficazes;
- parciais;
- ineficazes;
- concluídas aguardando avaliação;
- primeiro e último exercício relacionados.

## Promoção para recuperação

Endpoint:

`POST /api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId/promote-recovery`

Regras:

- exige confirmação explícita;
- exige AAR finalizado;
- ação cancelada não pode ser promovida;
- não cria duplicata se já houver vínculo;
- cria `recovery_actions` com estado `PLANNED`;
- grava `source_continuity_action_id`;
- atualiza o vínculo da ação corretiva;
- registra auditoria.

A promoção é uma decisão humana.

O SIGDEC não cria ações de recuperação automaticamente.

## Recomendações de revisão do runbook

Endpoint:

`GET /api/v1/sidec/continuity/runbook/recommendations`

A recomendação é gerada somente quando uma mesma `recurrence_key` aparece em pelo
menos dois AARs finalizados.

A recomendação contém:

- recorrência;
- categoria;
- severidade;
- título;
- justificativa;
- quantidade de ocorrências;
- primeira ocorrência;
- última ocorrência;
- última lição relacionada;
- estado.

Estados:

- `OPEN`;
- `ACCEPTED`;
- `IMPLEMENTED`;
- `DISMISSED`.

## Regra de reabertura

Uma recomendação `IMPLEMENTED` ou `DISMISSED` não é reaberta pela mesma evidência.

Se surgir nova ocorrência da mesma chave após a última ocorrência já resolvida, o
SIGDEC pode criar uma nova recomendação.

Isso preserva histórico e evita reciclar artificialmente a mesma decisão.

## Decisão humana

Endpoint:

`PATCH /api/v1/sidec/continuity/runbook/recommendations/:id`

Transições suportadas:

- OPEN → ACCEPTED;
- OPEN → DISMISSED;
- ACCEPTED → IMPLEMENTED;
- ACCEPTED → DISMISSED.

Uma recomendação OPEN não pode ir diretamente para IMPLEMENTED.

Toda decisão exige fundamentação textual.

Recomendações resolvidas são imutáveis.

## Runbook

A recomendação não altera o runbook.

Mesmo quando marcada como IMPLEMENTED, a alteração efetiva continua dependendo do
fluxo já existente:

1. criar revisão em rascunho;
2. editar conteúdo;
3. validar;
4. ativar nova versão.

Isso preserva a separação entre:

- detecção de recorrência;
- recomendação;
- decisão administrativa;
- alteração documental;
- ativação operacional.

## Centro de Continuidade

A interface passa a mostrar:

### Recomendações de melhoria

- título;
- recorrência;
- categoria;
- severidade;
- quantidade de ocorrências;
- justificativa;
- datas;
- decisão e fundamentação.

Ações disponíveis conforme estado:

- Aceitar para revisão;
- Marcar implementada;
- Descartar.

### Histórico de eficácia por recorrência

Apresenta ações relacionadas à mesma chave ao longo dos exercícios, com:

- versão do runbook;
- data;
- ação;
- status;
- resultado de eficácia;
- observação de eficácia.

### Ações corretivas

Passam a mostrar:

- chave de recorrência;
- vínculo de risco;
- vínculo de recuperação;
- ação de promoção para recuperação quando elegível.

Na criação da ação, o operador pode informar a chave de recorrência.

## Segurança e governança

- recomendações não alteram runbook automaticamente;
- promoção para recuperação exige confirmação;
- AAR precisa estar finalizado para promoção;
- origem da ação de recuperação fica registrada;
- índice único impede mais de uma recuperação originada pela mesma ação corretiva;
- decisões sobre recomendações são auditadas;
- eficácia continua sendo avaliação humana;
- recorrência é calculada apenas a partir de AARs finalizados.

## Testes

A v1.30 adiciona cobertura de integração para:

- migration `0037`;
- coluna `recurrence_key`;
- vínculo `source_continuity_action_id`;
- tabela de recomendações;
- estados permitidos;
- severidades;
- unicidade da promoção para recuperação.

## Próxima evolução sugerida

- vincular recomendação aceita a uma revisão específica do runbook;
- criar proposta de mudança estruturada sem alterar automaticamente o rascunho;
- demonstrar quais trechos/etapas do runbook foram modificados em resposta à recomendação;
- exigir evidência antes de marcar recomendação como implementada;
- medir eficácia após a versão revisada entrar em exercício;
- fechar o ciclo recomendação → revisão → teste → evidência → eficácia.
