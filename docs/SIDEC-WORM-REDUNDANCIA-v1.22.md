# SIGDEC v1.22 — Redundância WORM multiponto

## Objetivo

Adicionar uma segunda cópia WORM independente do artefato SIDEC, com verificação
criptográfica cruzada entre os destinos e monitoramento explícito de degradação.

A v1.22 acrescenta:

- destino WORM secundário configurável;
- segundo bucket Object Lock em homologação;
- suporte a endpoint/região/credenciais próprios em produção;
- cópia secundária por `versionId`;
- verificação SHA-256 independente do primário e da réplica;
- comparação dos hashes observados nos dois destinos;
- detecção de réplica ausente;
- detecção de policy drift;
- sincronização monotônica de retenção e legal hold;
- health de redundância no Centro de Gestão;
- estado resumido de redundância na consulta pública;
- recibo e histórico completos da réplica no dossiê autenticado.

## Migration

- `0030_sidec_worm_replication.sql`

Tabelas:

- `sidec_archive_replicas`;
- `sidec_archive_replica_verifications`.

A réplica referencia o recibo WORM principal da mesma revisão.

## Destino primário e destino secundário

O destino principal continua usando:

```env
S3_ENDPOINT=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
SIDEC_WORM_BUCKET=
SIDEC_WORM_MODE=
```

O destino secundário utiliza:

```env
SIDEC_WORM_REPLICA_ENABLED=true
SIDEC_WORM_REPLICA_ENDPOINT=
SIDEC_WORM_REPLICA_REGION=
SIDEC_WORM_REPLICA_BUCKET=
SIDEC_WORM_REPLICA_ACCESS_KEY=
SIDEC_WORM_REPLICA_SECRET_KEY=
SIDEC_WORM_REPLICA_MODE=GOVERNANCE
```

Região e credenciais secundárias podem cair no conjunto principal quando omitidas.
Isso facilita homologação, mas em produção recomenda-se configurar um segundo
destino efetivamente independente.

## Homologação

A homologação cria automaticamente:

- `sigdec-worm-v1`;
- `sigdec-worm-replica-v1`.

Ambos são criados com:

`mc mb --with-lock`

Os dois buckets ficam no mesmo MinIO de homologação.

Isso valida:

- Object Lock;
- versionamento;
- fluxo de replicação;
- governança;
- comparação de hashes;
- health da redundância.

**Não deve ser descrito como redundância geográfica em homologação.**

## Produção

A mesma aplicação pode apontar a réplica para:

- outro MinIO;
- outro servidor;
- outro datacenter;
- storage S3 compatível;
- região/provedor separado.

Nenhuma alteração de código é necessária.

## Fluxo de replicação

Novo arquivamento principal:

1. sela o ZIP;
2. arquiva o primário;
3. verifica SHA-256 do primário;
4. se a réplica estiver habilitada, tenta criar a segunda cópia;
5. registra `versionId` próprio da réplica;
6. baixa novamente a versão secundária;
7. recalcula SHA-256;
8. registra o resultado.

Falha da réplica não desfaz a preservação do primário.

O estado passa a aparecer como degradado até correção.

## Replicação manual

Endpoint:

`POST /api/v1/sidec-exports/:id/archive/replicate`

Usos:

- backfill de artefatos das v1.20/v1.21;
- retry de falhas;
- reconstrução operacional após indisponibilidade do destino secundário.

## Verificação da réplica

Endpoint:

`POST /api/v1/sidec-exports/:id/archive/replica/verify`

A verificação utiliza:

- bucket secundário;
- object key;
- **versionId exata**;
- hash esperado do ZIP original.

O resultado é persistido em:

- `sidec_archive_replica_verifications`.

## Scheduler

O avaliador periódico existente passa a verificar:

- destino principal;
- destino secundário, quando existente.

Métricas internas:

- primários verificados;
- falhas primárias;
- réplicas verificadas;
- falhas de réplica.

## Governança e consistência

Retenção e legal hold permanecem governados pelo destino principal.

Após:

- extensão de retenção;
- ativação de legal hold;

o SIGDEC tenta sincronizar a réplica.

A sincronização secundária é **monotônica**:

- pode aumentar `retainUntil`;
- pode ativar legal hold;
- não reduz retenção;
- não remove legal hold.

## Ausência de transação distribuída

S3/MinIO independentes não participam de uma transação ACID comum.

Por isso a v1.22 não simula rollback entre storages.

Se o primário aceitar uma alteração e o secundário estiver indisponível:

1. o primário permanece protegido;
2. o PostgreSQL registra o estado principal;
3. o sistema detecta `POLICY_DRIFT`;
4. o operador pode sincronizar a réplica posteriormente.

Isso é mais seguro do que desfazer ou ocultar uma proteção já efetivada.

## Sincronização manual de política

Endpoint:

`POST /api/v1/sidec-exports/:id/archive/replica/sync-policy`

A operação compara:

- retain-until principal;
- retain-until secundário;
- legal hold principal;
- legal hold secundário.

A réplica só recebe operações que aumentem a proteção.

## Health de redundância

Endpoint:

`GET /api/v1/sidec/archive-replication-health`

Estados:

### HEALTHY

- primário e réplica existem;
- verificações recentes;
- hashes válidos;
- hashes observados idênticos;
- política secundária não é inferior à principal.

### MISSING_REPLICA

Existe arquivo WORM principal, mas ainda não existe cópia secundária.

### POLICY_DRIFT

A réplica existe, porém:

- retenção é menor que a principal; ou
- principal possui legal hold e réplica ainda não.

### STALE

Uma das verificações está ausente ou ultrapassou:

`SIDEC_WORM_STALE_HOURS`

### CRITICAL

Inclui:

- objeto remoto ausente;
- SHA-256 divergente;
- hashes observados entre os destinos diferentes.

## Centro de Gestão

A v1.22 acrescenta:

- contador de réplicas ausentes;
- contador de policy drift;
- painel de redundância;
- hash principal;
- hash secundário;
- comparação cruzada;
- link direto para a revisão afetada.

## Tela da revisão

A área WORM passa a exibir separadamente:

- arquivo principal;
- réplica secundária;
- modo de lock;
- retenção;
- legal hold;
- data de replicação;
- última verificação;
- comparação de hashes.

Ações:

- Criar réplica WORM;
- Verificar réplica;
- Sincronizar política.

## Consulta pública

A consulta por SHA-256 não expõe:

- bucket;
- endpoint;
- credenciais;
- object key;
- versionId.

Ela mostra somente:

- redundância habilitada;
- réplica criada;
- validade do primário;
- validade da réplica;
- igualdade dos hashes;
- alinhamento de política;
- data da última verificação secundária.

## Dossiê autenticado

O dossiê de evidências passa a incluir:

- recibo da réplica;
- destination code;
- bucket;
- object key;
- versionId;
- ETag;
- modo Object Lock;
- retenção;
- legal hold;
- SHA-256;
- histórico completo de verificações secundárias.

## Segurança

- a réplica não altera o ZIP original;
- cada destino possui sua própria versionId;
- a object key continua derivada somente do SHA-256;
- o SIGDEC compara bytes, não apenas ETag;
- secrets do segundo destino não entram no banco;
- falha secundária não reduz a proteção do primário;
- policy drift fica explícito;
- sincronização nunca encurta retenção ou remove legal hold.

## Próxima evolução sugerida

- política automática de retry/backoff da réplica;
- replicação para terceiro destino;
- quorum de preservação;
- métricas históricas de disponibilidade;
- testes periódicos de restauração;
- exportação de relatório de resiliência;
- alerta externo quando redundância permanecer degradada;
- destino geograficamente separado na infraestrutura de produção.
