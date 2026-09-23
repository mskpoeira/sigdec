# SIGDEC v1.8 — Monitoramento operacional por limiares

## Entregue

- cadastro de limiares por estação, métrica e unidade;
- severidades WATCH, WARNING e EMERGENCY;
- comparações maior/igual (GTE) e menor/igual (LTE);
- avaliação automática de cada nova leitura contra os limiares ativos;
- geração de eventos operacionais vinculados à leitura e ao limiar;
- eventos com estados OPEN, ACKNOWLEDGED e CLOSED;
- reconhecimento e encerramento de eventos pela equipe;
- trilha de auditoria nas mudanças de estado dos eventos;
- consulta das últimas leituras por estação/métrica;
- painel operacional de monitoramento em /monitoramento;
- registro manual de leituras para contingência e testes;
- orientação operacional associada ao limiar;
- segregação por organização;
- ausência de publicação automática de alertas externos.

## Governança

A ultrapassagem de um limiar cria um evento operacional para apoio à decisão.
Ela não publica automaticamente um alerta à população. A publicação permanece
uma decisão humana no módulo de alertas, preservando governança e responsabilidade
operacional.

## Banco de dados

A migração `0014_monitoring_protocols.sql` cria:

- `monitoring_thresholds`;
- `monitoring_events`;
- índices por estação, métrica, organização e status.

## Próxima evolução

Conectar eventos de monitoramento ao Centro de Gestão, permitir criação assistida
de alerta a partir de um evento, ampliar protocolos e preparar integrações externas
de pluviômetros/sensores por API ou webhook.
