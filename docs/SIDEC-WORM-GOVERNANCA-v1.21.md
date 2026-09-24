# SIGDEC v1.21 — Governança monotônica de preservação WORM

## Objetivo

Evoluir o arquivo Object Lock introduzido na v1.20 para um fluxo de governança
operacional que permita aumentar a proteção do artefato sem oferecer ações que
a reduzam.

A v1.21 acrescenta:

- verificação da versão S3 exata registrada no recibo;
- extensão de retenção remota;
- ativação de legal hold;
- proibição de encurtamento da retenção;
- proibição de remoção de legal hold nesta versão;
- motivo obrigatório para mudanças de preservação;
- histórico próprio de eventos de governança;
- sincronização entre MinIO/S3 e PostgreSQL;
- monitor de saúde WORM no Centro de Gestão;
- classificação HEALTHY / STALE / CRITICAL;
- verificação manual diretamente pelo Centro de Gestão;
- histórico de governança na revisão e no dossiê de evidências.

## Princípio monotônico

A v1.21 implementa somente mudanças que **aumentam ou mantêm** a preservação.

Permitido:

- estender `retain_until` para uma data posterior;
- adicionar retenção futura a um objeto que estava apenas em legal hold;
- ativar legal hold.

Não permitido:

- encurtar retenção;
- informar data de retenção passada;
- remover legal hold;
- reduzir `COMPLIANCE` para `GOVERNANCE`;
- alterar a política local de modo independente do armazenamento remoto.

A liberação de legal hold exige um fluxo administrativo específico e não faz
parte desta versão.

## Migration

- `0029_sidec_worm_governance.sql`

Nova tabela:

- `sidec_archive_policy_events`

Eventos suportados:

- `RETENTION_EXTENDED`;
- `LEGAL_HOLD_ENABLED`.

Não existem eventos de redução de proteção na v1.21.

## Verificação pela versão exata

A v1.20 registrava `version_id` no recibo.

A v1.21 passa a utilizar esse valor nas operações:

- `GetObject`;
- `GetObjectRetention`;
- `GetObjectLegalHold`;
- `PutObjectRetention`;
- `PutObjectLegalHold`.

Assim, a verificação e a governança se referem à versão exata do ZIP arquivado,
não apenas à versão atualmente resolvida pela object key.

## Extensão de retenção

Endpoint:

`POST /api/v1/sidec-exports/:id/archive/extend-retention`

Corpo:

```json
{
  "retainUntil": "2028-12-31T23:59:59.000Z",
  "reason": "Justificativa administrativa para ampliação da preservação."
}
```

Regras:

- a data precisa estar no futuro;
- se já existe uma retenção, a nova data precisa ser posterior;
- o modo existente é preservado;
- se ainda não existe modo de retenção, é aplicado o modo configurado em
  `SIDEC_WORM_MODE`.

Fluxo:

1. valida a solicitação;
2. atualiza primeiro o Object Lock remoto;
3. verifica novamente a versão exata;
4. confirma SHA-256 do ZIP;
5. somente depois atualiza o recibo e a retenção local;
6. grava evento de governança;
7. grava timeline;
8. grava audit log.

Isso reduz o risco de o PostgreSQL afirmar uma retenção que não foi efetivamente
aplicada no storage.

## Legal hold

Endpoint:

`POST /api/v1/sidec-exports/:id/archive/enable-legal-hold`

Corpo:

```json
{
  "reason": "Motivo administrativo/jurídico para preservação."
}
```

A v1.21 oferece apenas:

- `OFF → ON`.

Não existe endpoint para:

- `ON → OFF`.

Após ativar o hold, o SIGDEC:

1. aplica o hold na versão remota;
2. lê novamente o objeto;
3. exige `legalHold=true`;
4. confirma SHA-256;
5. sincroniza o estado local;
6. grava evento, timeline e auditoria.

## Histórico de governança

Cada evento registra:

- export ID;
- organização;
- tipo do evento;
- retenção anterior;
- nova retenção;
- legal hold anterior;
- novo legal hold;
- justificativa;
- usuário;
- data/hora.

O histórico é exibido na revisão SIDEC e também entra no dossiê de evidências.

## Saúde do arquivo WORM

Endpoint:

`GET /api/v1/sidec/archive-health`

Estados:

### HEALTHY

- objeto remoto existe;
- SHA-256 remoto confere;
- a última verificação está dentro do período de atualidade.

### STALE

- ainda não existe verificação; ou
- a última verificação ultrapassou o limiar configurado.

### CRITICAL

- objeto remoto não foi encontrado; ou
- SHA-256 remoto diverge do hash esperado.

## Limiar de verificação vencida

Variável:

`SIDEC_WORM_STALE_HOURS`

Padrão:

- 48 horas.

Esse valor não representa prazo legal.

É apenas o limite operacional para o Centro de Gestão considerar a confirmação
remota desatualizada.

## Centro de Gestão

A v1.21 acrescenta:

- cartão `WORM críticos`;
- cartão `WORM vencidos`;
- painel de preservação WORM;
- protocolo e revisão;
- estado HEALTHY/STALE/CRITICAL;
- modo Object Lock;
- legal hold;
- retenção;
- resultado SHA-256;
- última verificação;
- erro remoto;
- ação `Verificar agora`.

## Tela da revisão SIDEC

Para um ZIP já arquivado, a tela passa a permitir:

- verificação manual;
- extensão de retenção;
- ativação de legal hold;
- consulta do histórico de governança.

Toda alteração exige justificativa.

## Segurança

- a v1.21 não disponibiliza ações de redução de preservação;
- alterações remotas ocorrem antes da atualização local;
- a versão S3 exata é utilizada;
- o hash remoto é recalculado após mudanças;
- o modo COMPLIANCE existente não é rebaixado;
- a chave do objeto continua derivada somente do SHA-256;
- credenciais S3 não são expostas;
- governança não substitui política documental ou decisão jurídica.

## Limitações

- ativar legal hold não significa, por si só, que exista ordem judicial;
- `GOVERNANCE` continua permitindo determinadas ações administrativas com
  permissões específicas do storage;
- `COMPLIANCE` deve ser adotado somente com política formal;
- esta versão não implementa liberação de legal hold;
- esta versão não implementa redução de retenção.

## Testes

A v1.21 cobre:

- migration `0029`;
- existência da tabela de eventos;
- eventos permitidos;
- ausência de eventos de redução;
- typecheck dos comandos S3 de governança;
- telas de Centro de Gestão e revisão;
- build completo.

## Próxima evolução sugerida

- fluxo formal de liberação de legal hold com dupla autorização;
- replicação WORM para segundo destino;
- verificação automatizada da réplica;
- alertas externos quando um arquivo ficar CRITICAL;
- painel de cobertura de preservação por período;
- política documental parametrizada por classe documental;
- integração com storage institucional/cloud quando disponível.
