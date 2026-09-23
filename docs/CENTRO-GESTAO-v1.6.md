# SIGDEC v1.6 — Centro de Gestão: riscos e alertas

## Entregue

- Centro de Gestão operacional em `/gestao`;
- cadastro de riscos com código, categoria, probabilidade, impacto e mitigação;
- priorização visual pelo produto probabilidade × impacto;
- listagem de riscos reais persistidos no banco;
- criação de alertas operacionais com severidade;
- vínculo opcional do alerta a um risco cadastrado;
- listagem dos alertas recentes e respectivos estados;
- indicadores consolidados de riscos, alertas, S2iD, treinamentos e recuperação;
- autenticação e permissões existentes preservadas;
- API e banco existentes reutilizados, sem duplicação de domínio;
- identificação da release 1.6.0 no Web, API e healthcheck.

## Arquitetura

A v1.6 operacionaliza estruturas que já haviam sido preparadas no núcleo do SIGDEC.
Os registros continuam segregados por organização e protegidos pelas permissões
`risks.manage`, `alerts.manage` e `bi.read`.

## Próximos passos

Evoluir o Centro de Gestão com ciclo de vida dos alertas, protocolos, monitoramento
ambiental integrado, treinamentos/simulados, recuperação e S2iD.
