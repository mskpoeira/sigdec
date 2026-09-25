# SIGDEC v1.34 — Política temporal, WORM do relatório e tendências executivas

## Objetivo

A v1.34 amplia a governança do ciclo de melhoria do runbook SIDEC após a v1.33.

O foco é preservar o relatório final fora do banco transacional, tornar o quorum crítico temporalmente válido e dar visibilidade executiva sobre reincidência e eficácia.

## Política temporal das aprovações

Nova política por organização:

- `approval_valid_hours`;
- `report_worm_retention_days`;
- `report_worm_legal_hold`.

A validade operacional padrão das aprovações críticas é 168 horas quando ainda não houver política cadastrada.

Esse valor é operacional e configurável. Ele não representa prazo legal, arquivístico ou regulatório.

As aprovações `APPROVED` recebem `valid_until`.

Uma aprovação vencida:

- permanece no histórico;
- não é excluída;
- não compõe o quorum de duas aprovações;
- pode ser revalidada explicitamente pelo mesmo aprovador enquanto a proposta continuar `PROPOSED`.

Uma decisão `REJECTED` não expira automaticamente. Ela continua bloqueando a aplicação até que o próprio aprovador registre nova decisão.

O proponente continua impedido de aprovar a própria mudança crítica.

## Revalidação

Ao registrar novamente `APPROVED` para uma aprovação já existente, o SIGDEC:

- renova `decided_at`;
- recalcula `valid_until` pela política vigente;
- registra `revalidated_at`;
- registra `revalidated_by`;
- mantém a auditoria da operação.

O quorum usado no momento da aplicação considera somente aprovações válidas no relógio do banco.

## Política WORM

O SIGDEC não define automaticamente prazo de retenção do relatório.

Para arquivar no WORM deve existir pelo menos uma destas condições:

- retenção em dias configurada; ou
- legal hold habilitado.

Se nenhuma estiver definida, o arquivamento é bloqueado com `WORM_REPORT_RETENTION_POLICY_REQUIRED`.

A configuração da política é um ato humano auditável.

## Arquivamento do relatório selado

Somente um relatório previamente:

1. verificado;
2. selado;
3. com SHA-256 íntegro no banco

pode ser enviado ao WORM.

Endpoint:

`POST /api/v1/sidec/continuity/runbook/change-proposals/:id/report/archive`

Antes do envio, o SIGDEC recalcula o SHA-256 do PDF armazenado e compara com o hash do selo.

O objeto WORM usa namespace próprio:

`sidec/continuity-change-reports/<prefixo>/<sha256>.pdf`

Metadados enviados ao storage:

- SHA-256;
- ID da proposta;
- nome lógico do arquivo;
- tipo do artefato;
- destino WORM.

## Recibo WORM

Nova tabela:

`sidec_continuity_change_report_archives`

Registra:

- bucket;
- object key;
- version ID;
- ETag;
- storage class;
- Object Lock mode;
- retenção;
- legal hold;
- content hash;
- responsável;
- instante de arquivamento.

O recibo é imutável por trigger de banco.

## Verificação do WORM

Após o upload, o SIGDEC realiza verificação imediata do objeto remoto.

Também existe verificação manual:

`POST /api/v1/sidec/continuity/runbook/change-proposals/:id/report/archive/verify`

Cada verificação registra:

- existência remota;
- SHA-256 observado;
- validade do hash;
- Object Lock mode;
- retain until;
- legal hold;
- origem da verificação;
- mensagem de erro;
- instante.

## Verificação periódica

Os relatórios selados arquivados foram incluídos no mesmo ciclo periódico já existente de checagem WORM.

O timer usa a cadência configurada por:

`SIDEC_WORM_VERIFICATION_MINUTES`

No mesmo ciclo são verificados:

- pacotes SIDEC arquivados;
- relatórios selados de mudanças de continuidade.

Assim, não existe um segundo agendador concorrente.

## Indicadores executivos

O endpoint:

`GET /api/v1/sidec/continuity/runbook/change-metrics`

passa a incluir:

- relatórios selados;
- relatórios arquivados;
- arquivos WORM íntegros;
- aprovações vencidas;
- aprovações que vencem em até 24 horas;
- eficácia consolidada;
- tempo médio até aplicação;
- tempo médio até verificação;
- distribuição por severidade;
- evolução mensal;
- tendências por chave de recorrência.

As tendências por recorrência mostram:

- quantidade de propostas;
- quantidade verificada;
- melhorias;
- regressões;
- data da última proposta.

## Interface

O Centro de Continuidade v1.34 exibe:

- política operacional vigente;
- configuração da validade das aprovações;
- configuração de retenção WORM;
- opção de legal hold;
- aprovações válidas e vencidas;
- revalidação explícita;
- total de aprovações vencidas e próximas do vencimento;
- status do arquivo WORM;
- retenção e legal hold do relatório;
- última verificação remota;
- ação de arquivar no WORM;
- ação de verificar o WORM;
- tendências por recorrência.

## Migration

`0041_sidec_continuity_worm_approval_policy.sql`

Principais alterações:

- `sidec_continuity_change_approvals.valid_until`;
- `sidec_continuity_change_approvals.revalidated_at`;
- `sidec_continuity_change_approvals.revalidated_by`;
- `sidec_continuity_change_policies`;
- `sidec_continuity_change_report_archives`;
- `sidec_continuity_change_report_archive_verifications`;
- trigger de imutabilidade do recibo WORM;
- permissão `sidec_continuity_change.archive`.

A migration inicializa aprovações `APPROVED` históricas sem validade usando `decided_at + 168 horas`, evitando perda silenciosa do estado anterior ao upgrade.

## Garantias

- aprovação vencida não autoriza aplicação crítica;
- aprovação vencida não é apagada;
- revalidação exige ação humana explícita;
- rejeição não some por decurso de tempo;
- política WORM não recebe prazo legal arbitrário do sistema;
- relatório não é arquivado antes de estar selado;
- hash local é conferido antes do upload;
- hash remoto é conferido depois do upload;
- recibo WORM é imutável;
- verificações remotas são históricas;
- decisões e mudanças de política são auditadas.

## Próxima evolução sugerida

- réplica WORM secundária também para os relatórios de mudança;
- extensão monotônica da retenção dos relatórios;
- delegação formal e temporária de aprovadores;
- tratamento explícito de divisão e fusão de etapas com linhagem múltipla;
- metas quantitativas de eficácia por categoria e recorrência;
- exportação executiva consolidada de governança por período.
