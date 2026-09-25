# SIGDEC v1.37 — Linhagem múltipla de etapas do runbook

## Objetivo

A v1.37 elimina a limitação de linhagem 1:1 entre etapas de revisões consecutivas. O SIGDEC passa a representar explicitamente divisão, fusão e derivação de etapas.

## Relações

A tabela `sidec_continuity_step_lineage_links` liga etapas da revisão-base às etapas da revisão-alvo.

O sistema deriva três relações:

- `SPLIT`: uma etapa de origem gera duas ou mais etapas no novo runbook;
- `MERGED`: duas ou mais etapas de origem formam uma única etapa nova;
- `DERIVED`: uma etapa nova substitui a origem com nova identidade, preservando a rastreabilidade.

Etapas mantidas normalmente entre revisões continuam usando `lineage_key` estável.

## Edição

No rascunho, o operador pode:

- dividir uma etapa;
- fundir uma etapa com a próxima;
- editar normalmente etapas com identidade preservada.

A interface mostra quando uma etapa mantém a identidade ou possui múltiplas origens.

## Validações

- uma etapa não pode manter `lineageKey` e declarar `sourceLineageKeys` simultaneamente;
- origens duplicadas são recusadas;
- origens devem existir na revisão-base;
- linhagem múltipla exige uma revisão-base;
- identidades diretas continuam únicas no rascunho.

## Diff e auditoria

O diff estrutural passa a usar:

- `ADDED`;
- `MODIFIED`;
- `REMOVED`;
- `SPLIT`;
- `MERGED`;
- `DERIVED`.

Os impactos guardam `lineage_details` com o snapshot das origens e destinos, permitindo explicar a transformação mesmo depois de novas revisões.

## Migration

`0045_sidec_continuity_multilineage.sql`

- amplia o check de `change_type`;
- adiciona `lineage_details`;
- cria `sidec_continuity_step_lineage_links` e índices de navegação.
