# SIGDEC v1.7 — Ciclo de vida de riscos e alertas

## Entregue

- estados controlados para riscos: ACTIVE, MITIGATED e CLOSED;
- estados controlados para alertas: DRAFT, PUBLISHED e CLOSED;
- publicação e encerramento de alertas pelo Centro de Gestão;
- mitigação, encerramento e reabertura de riscos;
- data de início automática na publicação do alerta;
- data de término automática no encerramento;
- validação de organização em todas as transições;
- auditoria append-only de cada alteração de estado;
- registro do usuário, IP, user-agent e dados anterior/posterior;
- constraints no PostgreSQL para impedir estados inválidos;
- indicadores do Centro de Gestão atualizados após cada operação.

## Segurança operacional

As transições usam as permissões existentes `risks.manage` e `alerts.manage`.
Nenhuma rota permite alterar registros de outra organização. A trilha de auditoria
existente é reutilizada e permanece sem operações de edição/exclusão expostas.

## Próxima evolução

Integrar alertas ao monitoramento ambiental e protocolos operacionais, preparando
gatilhos por leitura de estações e a futura integração com fontes externas.
