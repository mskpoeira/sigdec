# SIGDEC v1.20 — Arquivamento WORM / S3 Object Lock

## Objetivo

Adicionar uma segunda camada de preservação ao ZIP SIDEC já selado no PostgreSQL,
armazenando uma cópia em bucket S3/MinIO com Object Lock habilitado.

A v1.20 acrescenta:

- bucket dedicado a artefatos SIDEC com Object Lock;
- arquivamento do ZIP selado via S3;
- retenção por objeto em GOVERNANCE ou COMPLIANCE;
- suporte a legal hold;
- recibo técnico de arquivamento;
- verificação imediata após upload;
- recálculo SHA-256 dos bytes remotos;
- verificação manual;
- verificação periódica automática;
- histórico de verificações;
- estado WORM no histórico operacional;
- estado de preservação na consulta pública por hash;
- bloqueio da edição local de retenção depois do arquivamento.

## Princípio de separação

O artefato primário continua sendo:

- `sidec_export_artifacts`

Essa tabela permanece imutável.

O arquivo WORM é uma cópia adicional em armazenamento de objetos, registrada em:

- `sidec_archive_receipts`

As verificações são registradas em:

- `sidec_archive_verifications`

Assim, a preservação externa não altera os bytes, hashes ou assinaturas do artefato
selado original.

## Migration

- `0028_sidec_worm_archive.sql`

Estruturas principais:

- `sidec_archive_receipts`;
- `sidec_archive_verifications`;
- permissão `sidec_archive.manage`.

## Bucket dedicado

Homologação:

`SIDEC_WORM_BUCKET=sigdec-worm-v1`

O serviço `minio-init` cria o bucket com:

`mc mb --ignore-existing --with-lock`

O Object Lock implica versionamento no MinIO/S3.

O bucket WORM é separado do bucket comum da aplicação.

## Configuração

```env
SIDEC_WORM_BUCKET=sigdec-worm-v1
SIDEC_WORM_MODE=GOVERNANCE
SIDEC_WORM_VERIFICATION_MINUTES=1440
```

Modos aceitos:

- `GOVERNANCE`;
- `COMPLIANCE`.

### GOVERNANCE

É o padrão da homologação.

Protege o objeto contra alteração/exclusão durante a retenção, salvo operações
administrativas explicitamente autorizadas a ignorar governance retention.

### COMPLIANCE

É mais restritivo.

Deve ser adotado somente após definição formal de política de preservação, porque
um objeto em modo COMPLIANCE não deve ser removido ou ter sua retenção encurtada
antes do prazo.

O SIGDEC não escolhe automaticamente uma temporalidade legal.

## Pré-condição de arquivamento

Antes do envio ao Object Lock, a revisão precisa possuir:

- classe de retenção diferente de `UNSPECIFIED`;
- uma data `retain_until`; ou
- `legal_hold=true`.

Isso impede o sistema de inventar um prazo administrativo ou arquivístico.

## Fluxo de arquivamento

Endpoint:

`POST /api/v1/sidec-exports/:id/archive`

Fluxo:

1. confirma que o ZIP está selado;
2. lê a política de retenção;
3. recalcula SHA-256 do ZIP local;
4. recusa o envio se houver divergência;
5. envia o ZIP ao bucket WORM;
6. aplica Object Lock por objeto;
7. aplica legal hold quando configurado;
8. grava o recibo;
9. baixa novamente os bytes remotos;
10. recalcula SHA-256;
11. compara com o hash original;
12. grava a verificação;
13. registra timeline e auditoria.

Se a leitura remota não confirmar o mesmo SHA-256, a operação não é apresentada
como íntegra.

## Chave do objeto

A chave deriva exclusivamente do SHA-256:

`sidec/<primeiros-2-hex>/<artifactHash>.zip`

Exemplo:

`sidec/ab/abcdef...zip`

Isso evita nomes baseados em dados pessoais, protocolo ou conteúdo operacional.

## Recibo de arquivamento

O recibo registra:

- bucket;
- object key;
- version ID;
- ETag;
- storage class;
- modo Object Lock;
- data de retenção;
- legal hold;
- SHA-256;
- usuário responsável;
- data/hora.

O conteúdo do objeto não é duplicado no recibo.

## Verificação remota

A função de verificação usa `GetObject`.

Ela:

- recupera os bytes;
- recalcula SHA-256;
- compara com `expected_hash`;
- lê, quando permitido pelo backend S3:
  - Object Lock mode;
  - retain-until date;
  - legal hold.

Endpoint manual:

`POST /api/v1/sidec-exports/:id/archive/verify`

Consulta do recibo:

`GET /api/v1/sidec-exports/:id/archive`

## Verificação periódica

Variável:

`SIDEC_WORM_VERIFICATION_MINUTES`

Padrão:

- 1440 minutos (24 horas).

Mínimo aplicado pelo servidor:

- 60 minutos.

O servidor verifica os recibos arquivados e registra cada resultado em
`sidec_archive_verifications`.

## Bloqueio de retenção local

Depois que existe `sidec_archive_receipts` para uma revisão, o endpoint de
retenção rejeita alterações com:

`ARCHIVE_RETENTION_LOCKED`

Motivo:

a política local não deve divergir da retenção efetivamente aplicada no
armazenamento Object Lock.

Uma futura extensão de prazo ou alteração de legal hold deve utilizar um fluxo
que modifique primeiro o backend S3 e só depois sincronize o PostgreSQL.

## Interface operacional

A tela SIDEC da ocorrência mostra:

- se o ZIP está arquivado;
- modo Object Lock;
- retenção remota;
- legal hold;
- bucket/chave para usuários autenticados;
- data de arquivamento;
- última verificação;
- estado do SHA-256 remoto;
- erro de storage, quando houver.

Ações:

- `Arquivar em Object Lock`;
- `Verificar arquivo agora`.

## Consulta pública

A rota pública por SHA-256 continua sem revelar bucket ou object key.

Ela passa a mostrar somente:

- `preserved`;
- modo de lock;
- data de retenção;
- legal hold;
- confirmação de existência remota;
- validade do SHA-256;
- última verificação.

Assim terceiros podem saber se o artefato possui uma camada adicional de
preservação sem obter detalhes internos de infraestrutura.

## Dossiê de evidências

A exportação de evidências da revisão passa a incluir:

- recibo WORM;
- histórico das verificações remotas;
- modo de Object Lock;
- versão do objeto;
- ETag;
- resultados SHA-256.

## Segurança e limitações

- Object Lock é uma camada adicional e não substitui SHA-256, HMAC e Ed25519;
- o SIGDEC verifica bytes remotos, não apenas ETag;
- bucket WORM possui versionamento;
- credenciais S3 não são incluídas em recibos ou comprovantes;
- o modo padrão GOVERNANCE não deve ser descrito como retenção legal irremovível;
- COMPLIANCE exige decisão administrativa consciente;
- as classes de retenção do SIGDEC não constituem, por si só, tabela de temporalidade documental;
- legal hold deve refletir decisão administrativa/jurídica apropriada.

## Infraestrutura de homologação

Serviços:

- `minio`;
- `minio-init`;
- `api`;
- `web`.

A API depende de `minio-init: service_completed_successfully`.

Isso impede a API de iniciar antes da preparação do bucket WORM.

## Testes

A v1.20 acrescenta cobertura para:

- derivação da object key;
- validação do modo GOVERNANCE/COMPLIANCE;
- migration `0028`;
- tabelas de recibo e verificação;
- constraints dos modos;
- constraints das origens de verificação;
- typecheck do AWS SDK;
- build completo.

## Próxima evolução sugerida

- extensão de retenção WORM sincronizada com S3;
- fluxo formal para legal hold e liberação;
- replicação do bucket para segundo destino;
- verificação de versão específica pelo `versionId`;
- monitor de falhas de preservação no Centro de Gestão;
- integração futura com storage externo institucional ou cloud S3;
- TSA externa/ICP-Brasil quando houver contrato e política apropriados.
