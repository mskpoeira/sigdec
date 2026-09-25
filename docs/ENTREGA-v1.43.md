# SIGDEC v1.43 — Fila de webhooks concorrente

Cada entrega agora é assumida por uma única execução com bloqueio de linha no
PostgreSQL (`FOR UPDATE SKIP LOCKED`). A tentativa ganha um identificador de
posse e prazo de cinco minutos. A conclusão atualiza a fila somente quando a
posse ainda corresponde à execução que fez o envio.

Se o processo cair, uma nova execução pode recuperar a entrega após o prazo.
Tentativas interrompidas também contam para o limite de dez. Uma entrega na
última tentativa que expirar passa a `FAILED`. O painel inclui entregas em
processamento na contagem de pendências.

O contrato continua sendo **entrega pelo menos uma vez**. Se o destinatário
receber o HTTP e o SIGDEC cair antes de registrar o sucesso, o reenvio pode
repetir o evento. O cabeçalho `X-SIGDEC-Delivery` mantém o mesmo identificador
para que o destinatário elimine duplicatas.

Migration: `0049_webhook_delivery_claims.sql`. O teste de integração verifica
posse concorrente, recuperação após expiração e rejeição de uma posse antiga.
