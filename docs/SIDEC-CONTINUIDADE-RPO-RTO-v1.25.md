# SIGDEC v1.25 — Objetivos de continuidade RPO/RTO

## Objetivo

Adicionar ao módulo de resiliência SIDEC metas administrativas de continuidade, com parâmetros configuráveis e avaliação objetiva baseada nas evidências já registradas pelo SIGDEC.

A v1.25 não transforma métricas internas em SLA contratual e não declara que um drill de arquivo equivale à recuperação integral do sistema.

## Migration

- `0032_sidec_continuity_objectives.sql`

Nova tabela:

- `sidec_resilience_policies`

Parâmetros por organização:

- RPO administrativo de replicação, em minutos;
- RTO administrativo de referência, em minutos;
- idade máxima aceita para evidência de drill, em horas;
- ativação ou desativação da política;
- usuário e data da última atualização.

Valores padrão:

- RPO: 1.440 minutos;
- RTO: 240 minutos;
- drill: 168 horas.

## RPO administrativo

O SIGDEC compara a meta de RPO com a replicação WORM.

São considerados:

- quantidade de arquivos primários;
- quantidade de réplicas existentes;
- réplicas ausentes;
- maior atraso observado entre o arquivamento primário e a criação da réplica.

Estados:

- `COMPLIANT`: cobertura completa e atraso observado dentro da meta;
- `BREACH`: réplica ausente ou atraso superior ao objetivo;
- `INSUFFICIENT_DATA`: ausência de artefatos, atraso mensurável insuficiente ou réplica desabilitada;
- `DISABLED`: política administrativa desativada.

## RTO administrativo

O RTO é comparado com a duração dos drills de restauração bem-sucedidos.

Quando a réplica está habilitada, o cálculo exige evidência dos dois destinos:

- PRIMARY;
- REPLICA.

É utilizada a pior duração dos drills exigidos.

Importante: esse valor é uma evidência operacional de restauração dos artefatos e não representa, isoladamente, o tempo total necessário para recuperar o SIGDEC, banco de dados, infraestrutura, rede ou serviços externos.

## Atualidade dos drills

A política também define a idade máxima aceita para a evidência de restauração.

Quando primário e réplica são exigidos, ambos precisam possuir drill bem-sucedido dentro da janela administrativa.

## API

### Consultar política

`GET /api/v1/sidec/resilience/policy`

### Atualizar política

`PUT /api/v1/sidec/resilience/policy`

Exemplo:

```json
{
  "enabled": true,
  "rpoMinutes": 1440,
  "rtoMinutes": 240,
  "drillMaxAgeHours": 168
}
```

A alteração exige `sidec_resilience.manage` e gera registro em `audit_logs`.

### Consultar prontidão

`GET /api/v1/sidec/resilience/readiness`

Retorna:

- política efetiva;
- métricas observadas;
- estado geral;
- avaliação do RPO;
- avaliação do RTO;
- validade dos drills;
- nota metodológica.

## Relatório de resiliência

O schema passa para:

- `sigdec-sidec-resilience-report/1.2`

O relatório JSON e o PDF incluem:

- metas administrativas;
- estado geral de prontidão;
- RPO observado;
- RTO observado em drill;
- idade das evidências;
- justificativas de conformidade ou violação.

## Centro de Gestão

A tela passa a permitir:

- visualizar o estado geral de continuidade;
- confrontar valor observado e meta de RPO;
- confrontar duração de drill e meta de RTO;
- verificar idade da evidência;
- editar RPO;
- editar RTO;
- editar validade máxima do drill;
- ativar ou desativar a política.

## Auditoria

Toda alteração da política registra:

- usuário;
- data/hora;
- IP;
- user-agent;
- configuração anterior;
- configuração nova.

## Segurança e limites

A v1.25:

- não altera objetos WORM;
- não reduz retenção;
- não remove legal hold;
- não executa failover;
- não declara SLA externo;
- não considera drill de objeto como recuperação integral da plataforma.

## Próxima evolução sugerida

- runbook de desastre versionado;
- execução controlada de exercícios de recuperação;
- checklists de failover e retorno;
- contatos e responsabilidades do plano de continuidade;
- notificações externas de violação persistente de RPO/RTO.
