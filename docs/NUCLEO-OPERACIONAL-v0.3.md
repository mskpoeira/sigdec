# SIGDEC v0.3 — Núcleo Operacional

## Entregue nesta fase

- tipos de ocorrência configuráveis;
- classificação por grupo e prioridade padrão;
- protocolo sequencial anual por organização (`DC-AAAA-000001`);
- registro rápido de ocorrência;
- origem do chamado;
- prioridade P1–P5;
- marcador de risco à vida;
- endereço, bairro, ponto de referência e coordenadas;
- PostGIS para geolocalização;
- fila operacional;
- linha do tempo append-only;
- fluxo de status com transições controladas;
- equipes;
- viaturas;
- despacho de equipe/viatura;
- auditoria;
- metadados de anexos preparados;
- permissões granulares.

## Estados da ocorrência

RECEIVED → TRIAGE / WAITING_DISPATCH / DISPATCHED → EN_ROUTE → ON_SCENE → IN_SERVICE / INSPECTION / MONITORING → COMPLETED → CLOSED.

Também existem CANCELLED e DUPLICATE.

## Próximas evoluções

1. tela de detalhe da ocorrência e linha do tempo;
2. interface completa de despacho em tempo real;
3. cadastro administrativo de equipes/viaturas;
4. upload de fotos e vídeos para MinIO;
5. GPS do agente e mapa operacional;
6. PWA/offline;
7. chamadas 199 separadas da ocorrência;
8. integração de rádio e livro de plantão.
