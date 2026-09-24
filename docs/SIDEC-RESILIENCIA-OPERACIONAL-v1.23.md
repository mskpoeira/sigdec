# SIGDEC v1.23 — Resiliência operacional WORM

## Objetivo

Evoluir a redundância WORM da v1.22 para um modelo operacional de resiliência,
com recuperação testada, retry controlado e indicadores históricos.

A v1.23 acrescenta:

- fila idempotente de retry da réplica;
- backoff exponencial configurável;
- retry automático para réplica ausente;
- retry automático para policy drift;
- condições persistentes de degradação;
- alerta somente após degradação persistir além do limiar;
- drill de restauração do primário;
- drill de restauração da réplica;
- download da versionId exata durante o drill;
- validação SHA-256;
- validação do tamanho recuperado;
- validação do header ZIP;
- scheduler de resiliência independente;
- métricas históricas de verificações;
- relatório de resiliência por período;
- UI operacional no Centro de Gestão;
- drill manual na revisão SIDEC.

## Migration

- `0031_sidec_resilience_operations.sql`

Estruturas:

- `sidec_replica_retry_jobs`;
- `sidec_restore_drills`;
- `sidec_resilience_conditions`.

A migration também permite:

- `sidec_archive_replicas.replicated_by = NULL`

para distinguir réplicas criadas automaticamente pelo scheduler das ações manuais.

## Retry e backoff

Operações automáticas elegíveis:

- `REPLICATE`;
- `SYNC_POLICY`.

Condições:

### MISSING_REPLICA

O arquivo principal existe, mas a réplica secundária ainda não.

A v1.23:

1. cria/reativa um job `REPLICATE`;
2. executa quando `next_retry_at <= now()`;
3. confirma a réplica por leitura remota e SHA-256;
4. encerra o job em sucesso;
5. em falha, incrementa `attempts` e agenda novo retry.

### POLICY_DRIFT

A réplica existe, porém possui proteção inferior ao primário.

A v1.23 agenda:

- `SYNC_POLICY`.

A sincronização continua monotônica:

- aumenta retenção;
- ativa legal hold;
- não reduz retenção;
- não remove hold.

## Backoff exponencial

Configuração:

```env
SIDEC_REPLICA_RETRY_BASE_MINUTES=15
SIDEC_REPLICA_RETRY_MAX_MINUTES=1440
```

Sequência padrão aproximada:

- 15 min;
- 30 min;
- 60 min;
- 120 min;
- 240 min;
- até o teto configurado.

Não há retry destrutivo de um objeto WORM corrompido.

## Condições CRITICAL

Uma condição `CRITICAL` inclui, entre outros casos:

- objeto remoto ausente;
- SHA-256 divergente;
- hashes observados entre destinos diferentes.

A v1.23 **não tenta sobrescrever** um objeto WORM nessa situação.

Motivo:

- a cópia é imutável;
- sobrescrita automática ocultaria a evidência da falha;
- a intervenção deve ser explícita e auditável.

A condição é registrada e pode gerar alerta persistente.

## Condições de resiliência

Estados rastreados:

- `CRITICAL`;
- `MISSING_REPLICA`;
- `POLICY_DRIFT`;
- `STALE`.

Tabela:

- `sidec_resilience_conditions`.

Campos principais:

- primeira detecção;
- última detecção;
- momento em que virou alerta;
- resolução;
- detalhes técnicos.

Quando a condição muda, a anterior é encerrada e a nova passa a ser rastreada.

Quando o artefato volta a `HEALTHY`, condições abertas são resolvidas.

## Alerta por persistência

Configuração:

```env
SIDEC_RESILIENCE_ALERT_AFTER_HOURS=6
```

O SIGDEC não transforma toda degradação transitória em alerta imediatamente.

A condição só recebe `alerted_at` quando permanece aberta além do limiar.

Esse limiar é operacional e não representa prazo legal ou contratual.

Endpoint:

`GET /api/v1/sidec/resilience/alerts?open=true`

## Scheduler de resiliência

Configuração:

```env
SIDEC_RESILIENCE_EVALUATION_MINUTES=15
```

Mínimo aplicado:

- 5 minutos.

Em cada ciclo o SIGDEC:

1. avalia condições atuais;
2. abre/atualiza/resolve condições;
3. cria jobs de retry quando necessário;
4. executa retries vencidos;
5. verifica se há drills periódicos vencidos;
6. executa os drills elegíveis.

Esse scheduler é separado da verificação WORM periódica mais pesada.

## Drill de restauração

O drill baixa a **versionId exata** armazenada no recibo.

Destinos:

- `PRIMARY`;
- `REPLICA`.

Validações:

1. download da versão específica;
2. SHA-256 dos bytes recuperados;
3. comparação com o SHA-256 original;
4. comparação do tamanho recuperado;
5. validação da assinatura básica ZIP `PK`.

Tabela:

- `sidec_restore_drills`.

Registra:

- destino;
- hash esperado;
- hash observado;
- tamanho esperado;
- tamanho observado;
- validade do header ZIP;
- sucesso;
- duração;
- origem manual/agendada;
- erro;
- usuário, quando manual;
- data/hora.

## Drill periódico

Configuração:

```env
SIDEC_RESTORE_DRILL_HOURS=168
```

Padrão:

- 168 horas;
- equivalente a 7 dias.

Mínimo:

- 24 horas.

O scheduler executa drill somente quando o último teste daquele destino ultrapassou
a janela configurada.

## Drill manual

Endpoint:

`POST /api/v1/sidec-exports/:id/resilience/drill`

Exemplo:

```json
{
  "destination": "PRIMARY"
}
```

ou:

```json
{
  "destination": "REPLICA"
}
```

A tela da revisão disponibiliza:

- Drill de restauração do primário;
- Drill de restauração da réplica.

## Ambientes sem réplica habilitada

Se:

`SIDEC_WORM_REPLICA_ENABLED=false`

a v1.23:

- continua monitorando o primário;
- não gera falso `MISSING_REPLICA`;
- não cria retries secundários;
- não executa drills da réplica.

## Relatório de resiliência

Endpoint:

`GET /api/v1/sidec/resilience/report?days=30`

Download:

`GET /api/v1/sidec/resilience/report?days=30&download=1`

Schema:

`sigdec-sidec-resilience-report/1.0`

O período aceita:

- 1 a 365 dias.

Conteúdo:

### Redundância

- quantidade de arquivos primários;
- quantidade de réplicas;
- percentual de cobertura.

### Verificações primárias

- número de checagens;
- percentual de checagens com objeto disponível;
- percentual de checagens com SHA-256 válido.

### Verificações secundárias

Mesmos indicadores para a réplica.

### Drills

Por destino:

- quantidade;
- sucessos;
- percentual de sucesso;
- duração média.

### Condições

- detectadas;
- alertadas;
- resolvidas;
- alertas atualmente abertos.

### Retries

- jobs criados;
- pendentes;
- concluídos;
- total de tentativas.

Os percentuais refletem **resultados das checagens registradas**, não disponibilidade
contratual, SLA de provedor ou uptime contínuo.

## Centro de Gestão

A v1.23 acrescenta:

- contador de alertas de resiliência;
- cobertura de réplica;
- integridade primária;
- integridade secundária;
- alertas persistentes;
- link para investigação da revisão;
- download do relatório de 30 dias.

## Auditoria

Ações manuais de drill entram em:

- `audit_logs`.

Criação automática de réplica:

- pode usar `replicated_by = NULL`;
- registra timeline com indicação de retry automático.

Isso evita atribuir uma ação autônoma a um servidor humano.

## Segurança

- drills são somente leitura;
- usam a versionId exata;
- não sobrescrevem WORM;
- retries não tentam reparar CRITICAL destrutivamente;
- policy sync só aumenta proteção;
- hash é recalculado sobre os bytes recuperados;
- tamanho e assinatura ZIP são verificados separadamente;
- réplica desabilitada não gera falso incidente.

## Configuração padrão

```env
SIDEC_RESILIENCE_EVALUATION_MINUTES=15
SIDEC_REPLICA_RETRY_BASE_MINUTES=15
SIDEC_REPLICA_RETRY_MAX_MINUTES=1440
SIDEC_RESILIENCE_ALERT_AFTER_HOURS=6
SIDEC_RESTORE_DRILL_HOURS=168
```

## Próxima evolução sugerida

- relatório de resiliência em PDF;
- tendência mensal e série histórica;
- RPO/RTO administrativos configuráveis;
- testes de recuperação para ambiente temporário isolado;
- terceiro destino com quorum;
- notificações externas de degradação persistente;
- runbook de desastre e failover controlado.
