# SIGDEC v1.10 — Governança de integrações, protocolos e SITREP

## Entregue

- revogação imediata de chaves de ingestão;
- rotação de chave com revogação automática da anterior;
- novo token exibido somente uma vez;
- histórico de substituição entre chaves;
- auditoria de criação, rotação e revogação;
- protocolos operacionais versionados;
- versões em DRAFT, ACTIVE e RETIRED;
- somente uma versão ativa por protocolo;
- ativação de nova versão aposenta automaticamente a anterior;
- vínculo opcional de protocolo ativo aos limiares;
- evento de monitoramento copia a versão do protocolo vigente no momento do disparo;
- eventos exibem protocolo e passos operacionais;
- mapa de campo recebe sinais ambientais georreferenciados;
- SITREP consolidado do SCO;
- tela de campo exibe ocorrências, eventos ambientais, alertas, abrigos e situação operacional.

## Governança das chaves

A rotação cria uma nova credencial e revoga a anterior na mesma transação.
A credencial antiga deixa de ser aceita imediatamente. O SIGDEC continua
persistindo apenas o hash SHA-256 das chaves externas.

## Protocolos versionados

Os protocolos possuem código, título e categoria. Cada alteração operacional
é uma nova versão. Apenas versões ACTIVE podem ser vinculadas a novos limiares.

Quando uma leitura dispara um evento, o SIGDEC grava no evento a versão exata
do protocolo associada ao limiar. Alterações futuras no protocolo não modificam
retroativamente eventos históricos.

## SITREP operacional

O endpoint `GET /api/v1/sco/sitrep` consolida:

- ocorrências ativas, P1 e P2;
- eventos de monitoramento abertos e emergenciais;
- alertas publicados;
- abrigos abertos;
- famílias desalojadas e desabrigadas ainda assistidas;
- operações SCO e períodos operacionais ativos.

A visão de campo também recebe eventos de monitoramento com coordenadas da
estação, severidade e protocolo associado.

## Banco de dados

A migração `0016_protocols_keys_sitrep.sql` adiciona:

- metadados de revogação/rotação em `monitoring_ingest_keys`;
- `operational_protocols`;
- `operational_protocol_versions`;
- vínculo de protocolo em `monitoring_thresholds`;
- snapshot de versão em `monitoring_events`;
- permissão `protocols.manage`.

## Próxima evolução sugerida

- conectores específicos para fornecedores/pluviômetros reais;
- modelos de protocolo por COBRADE;
- geração de boletim/SITREP documental;
- camadas geoespaciais adicionais e histórico temporal no mapa;
- notificações internas por mudança de severidade.
