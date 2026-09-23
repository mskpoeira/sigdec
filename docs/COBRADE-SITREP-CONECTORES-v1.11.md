# SIGDEC v1.11 — COBRADE, SITREP documental, conectores e histórico geoespacial

## Entregue

- modelos de protocolo associados a código COBRADE;
- modelos COBRADE cadastráveis pela organização;
- instanciação de modelo como protocolo operacional em versão rascunho;
- geração automática de SITREP como documento técnico oficial em rascunho;
- numeração institucional REL-AAAA-NNNNNN;
- hash SHA-256, versão documental e trilha de auditoria no SITREP;
- snapshot imutável da situação usada para gerar cada SITREP;
- PDF, revisão, aprovação e emissão reaproveitam o módulo documental oficial existente;
- registro de conectores por estação;
- modos WEBHOOK, POLLING e MANUAL;
- ciclo CONFIGURED, ACTIVE, PAUSED e DISABLED para conectores;
- credenciais excluídas do registro de conector;
- histórico geoespacial de posições e eventos ambientais em janelas de 6, 24 e 72 horas;
- interface para modelos COBRADE, conectores, SITREP e histórico.

## Modelos COBRADE

O SIGDEC não pré-carrega códigos COBRADE nesta versão.
A organização informa o código oficial ao cadastrar o modelo, evitando a inclusão
de classificações não verificadas.

Um modelo pode conter:

- código interno;
- código COBRADE;
- título e categoria;
- severidade;
- resumo do gatilho;
- orientação;
- passos operacionais.

A instanciação cria um protocolo e sua primeira versão em DRAFT. A ativação
continua sendo uma decisão humana.

## SITREP documental

O endpoint `POST /api/v1/technical-documents/sitrep-draft` consolida e fotografa:

- ocorrências ativas, P1 e P2;
- eventos ambientais abertos e emergenciais;
- alertas publicados;
- abrigos abertos/lotados;
- famílias desalojadas e desabrigadas ainda assistidas;
- operações SCO e períodos operacionais ativos;
- lista das principais ocorrências;
- lista dos principais eventos de monitoramento.

O documento nasce em DRAFT e segue o fluxo oficial:
revisão → aprovação → emissão → PDF.

O campo `source_snapshot` mantém os dados usados na geração para preservar
rastreabilidade mesmo que os indicadores mudem depois.

## Conectores

A tabela `monitoring_connectors` registra metadados operacionais do conector,
não segredos.

Credenciais e tokens não devem ser persistidos em `config`.
A ingestão autenticada continua usando o mecanismo seguro de chaves já existente.

Nesta versão, POLLING representa a configuração do conector e prepara a arquitetura
para adaptadores futuros; nenhum endpoint arbitrário é executado automaticamente.

## Histórico geoespacial

`GET /api/v1/field/history?hours=N` aceita de 1 a 168 horas e retorna:

- posições registradas pelas equipes;
- eventos de monitoramento com coordenadas;
- severidade, estação, leitura e protocolo associado.

A interface oferece atalhos para 6h, 24h e 72h.

## Banco de dados

- `0017_cobrade_sitrep_documents.sql`
- `0018_monitoring_connectors.sql`

## Próxima evolução sugerida

- adaptadores específicos para fontes reais confirmadas;
- catálogo oficial COBRADE importável;
- boletim público derivado do SITREP com aprovação humana;
- mapa com camadas temporais e trilhas;
- testes automatizados de integração para ingestão, protocolos e documentos.
