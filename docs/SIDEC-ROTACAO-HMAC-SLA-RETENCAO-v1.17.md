# SIGDEC v1.17 — Rotação HMAC, SLAs operacionais e retenção SIDEC

## Objetivo

Preservar a verificabilidade histórica dos artefatos SIDEC quando houver rotação de
chaves, automatizar o acompanhamento de pendências com SLAs operacionais e separar
a política de retenção dos bytes imutáveis do ZIP selado.

A v1.17 acrescenta:

- identificador lógico da chave HMAC por artefato;
- compatibilidade explícita com assinaturas `legacy-v1` da v1.16;
- mapa de chaves históricas para rotação;
- `keyId` dentro do `manifesto.json`;
- políticas de SLA por estado operacional;
- avaliador automático periódico;
- alertas idempotentes de prazo;
- reconhecimento de alertas;
- data-limite/severidade na fila de pendências;
- metadados de retenção separados do ZIP;
- classe de retenção e legal hold;
- UI para SLAs, alertas e retenção.

## Versionamento de chaves HMAC

Nova coluna:

- `sidec_export_artifacts.signing_key_id`.

Artefatos já existentes recebem:

- `legacy-v1`.

A derivação de `legacy-v1` permanece exatamente compatível com a v1.16.

Novas chaves utilizam separação de domínio incluindo o `keyId`.

Configuração:

```env
SIDEC_MANIFEST_SIGNING_KEY_ID=legacy-v1
SIDEC_MANIFEST_SIGNING_SECRET=<segredo atual>
SIDEC_MANIFEST_SIGNING_KEYS_JSON=
```

Exemplo de rotação:

```env
SIDEC_MANIFEST_SIGNING_KEY_ID=2027-q1
SIDEC_MANIFEST_SIGNING_KEYS_JSON={"legacy-v1":"<segredo-antigo>","2027-q1":"<segredo-novo>"}
```

O segredo nunca é armazenado no banco.

Cada ZIP selado preserva apenas:

- `signing_key_id`;
- assinatura HMAC;
- hash do manifesto;
- hash do ZIP.

## Compatibilidade histórica

Para `legacy-v1`, a v1.17 usa o mesmo contexto criptográfico da v1.16:

`SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1`

Para chaves novas:

`SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1:<keyId>`

Isso permite manter verificáveis os artefatos históricos e usar contexto isolado
nas próximas rotações.

## Manifesto autocontido

Nas novas emissões, `manifesto.json` inclui:

```json
{
  "signature": {
    "algorithm": "HMAC-SHA256",
    "keyId": "2027-q1",
    "value": "...",
    "scope": "assinatura interna SIGDEC; não ICP-Brasil"
  }
}
```

O download selado também envia:

- `X-SIGDEC-Signing-Key-Id`.

## Retenção do artefato

A v1.17 mantém o ZIP em `sidec_export_artifacts` completamente imutável e cria
uma tabela separada:

- `sidec_artifact_retention`.

Campos:

- `retention_class`;
- `retain_until`;
- `legal_hold`;
- `notes`;
- usuário/data da alteração.

Classes:

- `UNSPECIFIED`;
- `OPERATIONAL`;
- `ARCHIVAL`;
- `LEGAL_HOLD`.

A atualização de retenção não altera:

- bytes do ZIP;
- SHA-256;
- assinatura;
- manifesto.

Endpoints:

- `GET /api/v1/sidec-exports/:id/retention`;
- `PATCH /api/v1/sidec-exports/:id/retention`.

## SLAs operacionais

Os SLAs são parâmetros administrativos de acompanhamento.

**Não representam prazo legal, normativo ou regulatório.**

Tabela:

- `sidec_deadline_policies`.

Estados acompanhados:

- `PACKAGE_READY`;
- `AWAITING_PROTOCOL`;
- `AWAITING_RETURN`;
- `REJECTED`.

Padrões globais iniciais:

| Estado | Horas | Severidade |
| --- | ---: | --- |
| PACKAGE_READY | 24 | WATCH |
| AWAITING_PROTOCOL | 24 | WARNING |
| AWAITING_RETURN | 72 | WARNING |
| REJECTED | 8 | EMERGENCY |

A organização pode substituir esses valores.

## Marcos temporais

- PACKAGE_READY → criação da revisão;
- AWAITING_PROTOCOL → data de exportação;
- AWAITING_RETURN → data de protocolo/submissão;
- REJECTED → data da rejeição.

Apenas a **revisão mais recente de cada ocorrência** participa do avaliador
automático.

Revisões antigas permanecem no histórico, mas não geram novos alertas.

## Avaliador automático

O servidor executa:

1. uma avaliação ao iniciar;
2. novas avaliações em intervalo configurável.

Variável:

`SIDEC_DEADLINE_EVALUATION_MINUTES`

Padrão:

- 60 minutos.

Mínimo:

- 5 minutos.

Os alertas usam constraint única para evitar duplicidade.

## Alertas de SLA

Tabela:

- `sidec_deadline_alerts`.

Cada alerta registra:

- ocorrência;
- revisão;
- estado pendente;
- severidade;
- `due_at`;
- momento de detecção;
- reconhecimento.

Endpoints:

- `GET /api/v1/sidec/deadline-alerts?open=true`;
- `PATCH /api/v1/sidec/deadline-alerts/:id/ack`.

Alertas de estados já superados deixam de aparecer na fila aberta, sem apagar o
histórico.

## Administração dos SLAs

Endpoints:

- `GET /api/v1/sidec/deadline-policies`;
- `PUT /api/v1/sidec/deadline-policies`.

Alterações são auditadas.

## Centro de Gestão

A v1.17 adiciona:

- contador de alertas SLA SIDEC;
- fila de alertas vencidos;
- botão de reconhecimento;
- editor de horas/severidade;
- indicação de `VENCIDO`;
- data/hora do SLA;
- severidade na própria pendência.

## Migration

- `0025_sidec_key_versions_deadlines_retention.sql`.

Estruturas:

- coluna `sidec_export_artifacts.signing_key_id`;
- `sidec_artifact_retention`;
- `sidec_deadline_policies`;
- `sidec_deadline_alerts`.

## Segurança

- segredos HMAC não são gravados no PostgreSQL;
- o ID da chave é persistido com o artefato;
- a verificação usa a chave histórica correspondente;
- ZIP selado continua imutável;
- retenção não modifica o artefato;
- alertas de SLA são idempotentes;
- permissões próprias controlam SLA e retenção.

## Próxima evolução sugerida

- assinatura assimétrica do manifesto para validação por terceiros sem acesso ao segredo HMAC;
- arquivamento WORM em object storage;
- exportação de comprovante de integridade independente;
- notificações externas configuráveis para SLAs vencidos;
- adaptador oficial SIDEC se houver API/contrato autorizado.
