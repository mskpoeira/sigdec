# SIGDEC v1.32 — Diff estrutural e eficácia das mudanças do runbook

## Objetivo

A v1.32 transforma a governança de mudanças criada na v1.31 em um ciclo mensurável e rastreável:

1. recomendação recorrente;
2. proposta humana vinculada a uma revisão;
3. comparação entre revisão-base e revisão-alvo;
4. ativação normal da revisão;
5. snapshot imutável do diff no momento da aplicação;
6. associação explícita da proposta às etapas afetadas;
7. exercício de verificação com AAR final;
8. comparação objetiva entre exercício anterior e exercício posterior;
9. relatório PDF consolidado.

Nenhuma alteração do runbook é feita automaticamente.

## Migration

Arquivo:

- `0039_sidec_continuity_change_effectiveness.sql`

### Linhagem de revisão

`sidec_continuity_plans.parent_plan_id` registra a revisão da qual a nova versão foi derivada.

Revisões já existentes recebem, quando possível, a revisão imediatamente anterior da mesma organização.

### Proposta de mudança

A tabela `sidec_continuity_change_proposals` passa a registrar:

- `base_plan_id`;
- `baseline_exercise_id`;
- `diff_snapshot`;
- `effectiveness_outcome`;
- `effectiveness_snapshot`.

Resultados de eficácia permitidos:

- `NO_BASELINE`;
- `IMPROVED`;
- `STABLE`;
- `REGRESSED`.

### Impactos por etapa

Nova tabela:

- `sidec_continuity_change_impacts`.

Cada registro liga a proposta a uma mudança estrutural de etapa e guarda:

- etapa-base, quando existir;
- etapa-alvo, quando existir;
- chave estrutural;
- tipo `ADDED`, `MODIFIED` ou `REMOVED`;
- fase;
- ordem;
- título;
- campos alterados.

## Diff estrutural

O SIGDEC compara a revisão-base com a revisão-alvo em dois níveis.

### Campos gerais

- título;
- critérios de ativação;
- estratégia de recuperação;
- plano de comunicação;
- retorno à normalidade.

### Etapas

As etapas são comparadas estruturalmente por:

`fase + sort_order`

Campos comparados:

- título;
- instruções;
- tempo esperado;
- responsável;
- obrigatoriedade.

Se fase ou ordem mudarem, a alteração é apresentada como remoção da posição anterior e adição da nova posição. Isso evita inferir identidade onde o schema histórico não possui uma chave de linhagem por etapa.

## Momento do snapshot

Enquanto a proposta está em `PROPOSED`, o resumo do diff é calculado sobre o rascunho atual.

Na transição:

`PROPOSED → APPLIED`

o SIGDEC:

- exige revisão-alvo ativada;
- exige pelo menos uma evidência;
- exige pelo menos uma alteração estrutural detectável;
- grava o `diff_snapshot`;
- grava os impactos por etapa;
- torna a recomendação `IMPLEMENTED`;
- registra auditoria.

Depois disso o diff utilizado para governança é o snapshot da aplicação, e não uma recomputação histórica.

## Comparação de eficácia

Na transição:

`APPLIED → VERIFIED`

continua sendo obrigatório:

- exercício da revisão-alvo;
- exercício `COMPLETED`;
- AAR `FINAL`.

A v1.32 também busca como baseline o exercício mais recente da revisão-base que esteja:

- concluído;
- com AAR final.

A comparação usa primeiro o resultado global:

- `PASS` > `PARTIAL` > `FAIL`.

Quando o resultado global é igual, o número de etapas em falha é usado como desempate.

Classificação:

- resultado posterior melhor ou menos falhas: `IMPROVED`;
- resultado e falhas equivalentes: `STABLE`;
- resultado posterior pior ou mais falhas: `REGRESSED`;
- ausência de exercício-base elegível: `NO_BASELINE`.

O sistema não apresenta essa classificação como decisão automática de gestão. Ela é uma comparação objetiva dos registros de exercício; a verificação continua sendo um ato humano auditado.

## API

### Consulta das propostas

`GET /api/v1/sidec/continuity/runbook/change-proposals`

Além dos dados da v1.31, retorna:

- revisão-base;
- resumo atual ou congelado do diff;
- impactos gravados;
- exercício-base;
- resultado de eficácia.

### Diff detalhado

`GET /api/v1/sidec/continuity/runbook/change-proposals/:id/diff`

- proposta ainda não aplicada: diff atual entre base e rascunho;
- proposta aplicada/verificada: snapshot congelado da aplicação.

### Relatório PDF

`GET /api/v1/sidec/continuity/runbook/change-proposals/:id/report.pdf`

O relatório consolida:

- recomendação;
- proposta;
- revisão-base e revisão-alvo;
- diff de campos e etapas;
- evidências;
- autoria e datas;
- baseline;
- exercício de verificação;
- resultado de eficácia;
- nota de governança.

## Interface

O Centro de Continuidade passa a exibir, em cada proposta:

- linhagem `vBase → vAlvo`;
- quantidade de campos gerais alterados;
- etapas adicionadas;
- etapas modificadas;
- etapas removidas;
- alerta quando nenhum diff foi detectado;
- eficácia após verificação;
- link para o relatório PDF.

A confirmação de aplicação só é oferecida quando há:

- revisão ativada;
- evidência;
- diff estrutural não vazio.

## Garantias

- recomendação não altera runbook;
- proposta não altera runbook;
- diff não altera runbook;
- cálculo de eficácia não altera runbook;
- revisão ativa continua imutável pela API;
- snapshot do diff é preservado na aplicação;
- baseline e verificação ficam vinculados à proposta;
- etapas afetadas são persistidas de forma explícita;
- todas as transições continuam auditadas.

## Testes

A integração valida:

- migration `0039`;
- `parent_plan_id`;
- colunas de baseline, diff e eficácia;
- tabela de impactos;
- tipos `ADDED`, `MODIFIED`, `REMOVED`;
- resultados `NO_BASELINE`, `IMPROVED`, `STABLE`, `REGRESSED`.

## Próxima evolução sugerida

- identidade estável por etapa entre revisões para detectar movimentação sem tratar como remoção + adição;
- metas quantitativas de eficácia por tipo de recorrência;
- aprovação em duas etapas para mudanças críticas;
- assinatura/selagem do relatório de mudança;
- indicadores consolidados por período, revisão e categoria de recorrência.
