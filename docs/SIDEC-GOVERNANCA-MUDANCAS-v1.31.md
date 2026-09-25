# SIGDEC v1.31 — Governança de mudanças do runbook

## Objetivo

Fechar o ciclo de melhoria contínua sem permitir que uma recomendação altere o runbook automaticamente.

A v1.31 estabelece o fluxo:

1. recomendação recorrente;
2. aceitação humana;
3. proposta de mudança ligada a uma revisão específica;
4. evidências de implementação;
5. ativação normal da revisão;
6. confirmação de aplicação;
7. exercício da revisão;
8. AAR final;
9. verificação da mudança.

## Migration

- `0038_sidec_continuity_change_governance.sql`

Estruturas:

- `sidec_continuity_change_proposals`;
- `sidec_continuity_change_evidence`.

Estados da proposta:

- `PROPOSED`;
- `APPLIED`;
- `VERIFIED`;
- `CANCELLED`.

Apenas uma proposta não cancelada pode existir por recomendação.

Uma proposta cancelada preserva o histórico e permite nova proposta posterior.

## Recomendação

A transição direta:

`ACCEPTED → IMPLEMENTED`

deixa de ser permitida pelo endpoint de recomendação.

O retorno é:

`CHANGE_PROPOSAL_REQUIRED`

A recomendação aceita só passa para `IMPLEMENTED` quando uma proposta vinculada é
marcada como `APPLIED` pelas regras abaixo.

Uma recomendação com proposta ativa também não pode ser descartada sem cancelar a
proposta primeiro.

## Criação da proposta

Endpoint:

`POST /api/v1/sidec/continuity/runbook/recommendations/:id/change-proposal`

Requisitos:

- recomendação em `ACCEPTED`;
- revisão-alvo da mesma organização;
- revisão-alvo em `DRAFT`;
- nenhuma proposta não cancelada já existente.

A proposta registra:

- recomendação;
- revisão específica;
- texto da mudança;
- autor;
- data/hora.

O SIGDEC não modifica automaticamente nenhum campo ou etapa do runbook.

## Evidências

Endpoint:

`POST /api/v1/sidec/continuity/runbook/change-proposals/:id/evidence`

Tipos:

- `NOTE`;
- `LINK`;
- `DOCUMENT`;
- `HASH`.

Campos:

- título;
- referência;
- SHA-256 opcional;
- autor;
- data/hora.

Propostas verificadas ou canceladas não aceitam novas evidências.

## Aplicação

Transição:

`PROPOSED → APPLIED`

Requisitos:

- recomendação ainda `ACCEPTED`;
- revisão-alvo já ativada;
- revisão em `ACTIVE` ou `RETIRED`;
- `activated_at` preenchido;
- pelo menos uma evidência registrada;
- fundamentação textual.

Quando a proposta é aplicada:

- proposta recebe `APPLIED`;
- usuário e data de aplicação são registrados;
- recomendação recebe `IMPLEMENTED`;
- fundamentação é gravada;
- auditoria registra revisão-alvo e quantidade de evidências.

Isso demonstra que a implementação passou pelo fluxo normal de edição e ativação
do runbook.

## Verificação

Transição:

`APPLIED → VERIFIED`

Requisitos:

- exercício da mesma organização;
- exercício baseado exatamente em `target_plan_id`;
- exercício em `COMPLETED`;
- AAR do exercício em `FINAL`;
- fundamentação textual.

A proposta registra:

- exercício utilizado;
- usuário verificador;
- data/hora;
- conclusão da verificação.

Não é suficiente testar uma versão diferente do runbook.

## Cancelamento

Transição:

`PROPOSED → CANCELLED`

Requisitos:

- proposta ainda em `PROPOSED`;
- motivo textual.

O cancelamento:

- não descarta a recomendação aceita;
- mantém o histórico;
- libera a recomendação para nova proposta futura.

## API de consulta

Endpoint:

`GET /api/v1/sidec/continuity/runbook/change-proposals`

Retorna:

- recomendação e chave de recorrência;
- revisão-alvo e estado;
- texto da proposta;
- estado e fundamentação;
- evidências;
- autor;
- aplicação;
- exercício de verificação;
- resultado do exercício;
- verificador.

## Centro de Continuidade

A interface passa a apresentar:

### Recomendação aceita

Se houver rascunho:

- `Criar proposta na revisão vN`.

Se não houver rascunho:

- `Criar revisão para tratar`.

O botão antigo `Marcar implementada` foi removido.

### Propostas de mudança controlada

Cada cartão apresenta:

- recomendação;
- recorrência;
- revisão-alvo;
- estado da revisão;
- texto proposto;
- evidências;
- fundamentação;
- aplicação;
- verificação.

Ações conforme estado:

- adicionar evidência;
- confirmar aplicação;
- cancelar proposta;
- verificar por exercício/AAR.

## Garantias

- recomendação não edita runbook;
- proposta não edita runbook;
- revisão continua passando por DRAFT → ACTIVE;
- aplicação exige evidência;
- implementação da recomendação acontece junto da aplicação da proposta;
- verificação exige exercício da revisão correta;
- AAR final é obrigatório para fechar a verificação;
- cancelamento não apaga histórico;
- decisões e transições são auditadas.

## Testes

A v1.31 valida:

- migration `0038`;
- tabelas de propostas e evidências;
- estados permitidos;
- tipos de evidência;
- campos de revisão e exercício de verificação;
- índice parcial de proposta ativa.

## Próxima evolução sugerida

- diff estrutural entre a revisão anterior e a revisão-alvo;
- associação explícita da proposta aos passos do runbook alterados;
- comparação de eficácia antes/depois da mudança;
- painel de mudanças verificadas e não verificadas;
- relatório PDF do ciclo recomendação → mudança → teste → eficácia.
