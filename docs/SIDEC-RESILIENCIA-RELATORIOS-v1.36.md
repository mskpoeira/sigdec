# SIGDEC v1.36 — Resiliência operacional dos relatórios WORM

## Objetivo

A v1.36 transforma a redundância dos relatórios selados em um processo operacional verificável e recuperável, com retry automático, condições persistentes de degradação e drills reais de restauração.

## Retry e backoff

Falhas de criação da réplica ou sincronização de política WORM geram jobs idempotentes.

A fila registra operação, tentativas, próximo retry, último erro e conclusão. A cadência usa o backoff exponencial já adotado pelo SIGDEC, respeitando:

- `SIDEC_REPLICA_RETRY_BASE_MINUTES`;
- `SIDEC_REPLICA_RETRY_MAX_MINUTES`.

## Drills de restauração

O SIGDEC pode baixar a versão exata do PDF no WORM principal ou secundário e validar:

- SHA-256;
- tamanho em bytes;
- assinatura inicial `%PDF-`;
- tempo de restauração.

Os drills podem ser manuais ou agendados. O intervalo usa `SIDEC_RESTORE_DRILL_HOURS`.

## Condições persistentes

O avaliador classifica os relatórios como:

- `CRITICAL`: objeto ausente, hash inválido ou divergência entre destinos;
- `MISSING_REPLICA`: réplica esperada não criada;
- `POLICY_DRIFT`: retenção/legal hold da réplica inferior ao principal;
- `STALE`: verificação remota vencida;
- `RESTORE_FAILURE`: último drill falhou;
- `HEALTHY`: sem degradação identificada.

Condições abertas ficam persistidas, são resolvidas automaticamente quando o estado melhora e podem ser marcadas como alertadas após o limiar configurado.

## Avaliador periódico

O timer de resiliência existente passa a executar em conjunto:

1. resiliência dos pacotes SIDEC;
2. resiliência dos relatórios selados de mudanças de continuidade.

Não é criado um segundo agendador concorrente.

## Interface

O Centro de Continuidade mostra:

- condições de resiliência abertas;
- retries pendentes;
- falhas de restauração dos últimos 30 dias;
- ação de drill no WORM principal;
- ação de drill na réplica.

## Migration

`0044_sidec_continuity_report_resilience.sql`

Cria:

- `sidec_continuity_change_report_retry_jobs`;
- `sidec_continuity_change_report_restore_drills`;
- `sidec_continuity_change_report_resilience_conditions`.

Os registros de drill são imutáveis por trigger.

## Garantias

- retry não cria duplicação de recibos;
- falha transitória recebe backoff;
- drill não altera o objeto remoto;
- sucesso exige hash, tamanho e cabeçalho PDF corretos;
- condições degradadas permanecem visíveis até resolução;
- réplica desabilitada não é tratada como falha artificial.
