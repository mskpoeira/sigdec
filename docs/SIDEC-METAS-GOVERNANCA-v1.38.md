# SIGDEC v1.38 — Metas de eficácia e governança executiva

## Objetivo

A v1.38 fecha o ciclo de governança das mudanças do runbook com metas quantitativas configuráveis e exportação consolidada por período.

## Metas quantitativas

As metas podem ser definidas em três escopos:

- `DEFAULT`: padrão da organização;
- `CATEGORY`: categoria das recomendações;
- `RECURRENCE`: chave específica de recorrência.

Cada meta pode controlar um ou mais indicadores:

- taxa mínima de propostas verificadas;
- taxa mínima de melhora entre mudanças avaliadas;
- tempo médio máximo entre criação e aplicação;
- tempo médio máximo entre aplicação e verificação.

O estado calculado é:

- `PASS`: todos os indicadores configurados atingiram a meta;
- `FAIL`: pelo menos um indicador ficou fora da meta;
- `NO_DATA`: o período não possui dados suficientes;
- `DISABLED`: meta desativada.

Essas metas são parâmetros administrativos internos e não constituem SLA legal, contratual ou normativo.

## Período

Relatórios e avaliações por período aceitam intervalo de até 730 dias. Sem período informado, o sistema usa os últimos 90 dias.

## Relatório executivo

Endpoint PDF:

`GET /api/v1/sidec/continuity/runbook/governance-report.pdf`

Endpoint CSV:

`GET /api/v1/sidec/continuity/runbook/governance-export.csv`

Ambos aceitam `from` e `to`.

O consolidado inclui:

- quantidade e verificação das propostas;
- criticidade;
- melhora, estabilidade e regressão;
- tempos médios de aplicação e verificação;
- aprovações, rejeições e delegações;
- selagem, WORM principal, réplica e integridade;
- condições de resiliência, retries e falhas de drill;
- metas e respectivo estado;
- distribuição por severidade;
- recorrências.

## Interface

O Centro de Continuidade passa a permitir:

- criar/atualizar metas por escopo;
- excluir metas;
- acompanhar o resultado da janela padrão;
- selecionar período;
- baixar PDF executivo;
- exportar CSV.

## Migration

`0046_sidec_continuity_effectiveness_targets.sql`

Cria `sidec_continuity_effectiveness_targets` com validações de faixa, escopo e pelo menos um indicador configurado.
