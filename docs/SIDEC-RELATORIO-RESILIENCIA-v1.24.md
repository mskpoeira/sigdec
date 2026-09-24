# SIGDEC v1.24 — Relatório gerencial e série histórica de resiliência SIDEC

## Objetivo

Evoluir a resiliência operacional WORM da v1.23 para uma camada gerencial de acompanhamento, sem alterar a imutabilidade dos artefatos ou os mecanismos de retry já existentes.

## Entregas

- relatório de resiliência em PDF;
- manutenção do relatório JSON técnico;
- schema do relatório atualizado para `sigdec-sidec-resilience-report/1.1`;
- série histórica mensal configurável de 3 a 24 meses;
- tendência de integridade e disponibilidade do primário;
- tendência de integridade e disponibilidade da réplica;
- contagem mensal de condições de resiliência detectadas;
- quantidade mensal de drills e drills bem-sucedidos;
- visualização dos seis meses mais recentes no Centro de Gestão;
- download direto do PDF gerencial e do JSON técnico;
- teste automatizado da geração do PDF.

## Endpoint

`GET /api/v1/sidec/resilience/report`

Parâmetros:

- `days`: janela dos indicadores consolidados, de 1 a 365 dias;
- `months`: série histórica mensal, de 3 a 24 meses, padrão 12;
- `download=1`: baixa o JSON técnico;
- `format=pdf`: baixa o relatório gerencial em PDF.

Exemplos:

`/api/v1/sidec/resilience/report?days=30&months=12`

`/api/v1/sidec/resilience/report?days=30&months=12&download=1`

`/api/v1/sidec/resilience/report?days=30&months=12&format=pdf`

## Série histórica

Cada mês informa:

- verificações do primário;
- disponibilidade observada do primário;
- integridade SHA-256 do primário;
- verificações da réplica;
- disponibilidade observada da réplica;
- integridade SHA-256 da réplica;
- condições de resiliência detectadas;
- drills executados;
- drills concluídos com sucesso.

Meses sem verificações retornam percentual nulo, evitando representar ausência de dados como 0% de integridade.

## PDF gerencial

O PDF inclui:

- identificação da organização;
- período analisado;
- cobertura de réplica;
- integridade primária e secundária;
- alertas persistentes;
- retries;
- drills de restauração;
- série histórica mensal;
- nota metodológica;
- paginação.

Os percentuais representam checagens efetivamente registradas e não equivalem a SLA contratual ou disponibilidade contínua de provedor.

## Segurança e auditoria

A v1.24 é exclusivamente de leitura e apresentação:

- não altera objetos WORM;
- não remove legal hold;
- não reduz retenção;
- não executa failover;
- não repara condição crítica automaticamente;
- não modifica regras de retry da v1.23.

## Próxima evolução sugerida

- RPO/RTO administrativos configuráveis;
- runbook de desastre e failover controlado;
- teste de recuperação em ambiente temporário isolado;
- notificação externa para degradação persistente;
- terceiro destino de preservação com quorum.
