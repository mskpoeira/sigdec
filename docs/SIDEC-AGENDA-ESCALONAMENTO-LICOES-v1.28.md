# SIGDEC v1.28 — Agenda, escalonamento, alertas e lições aprendidas

## Objetivo

Evoluir o Centro de Continuidade SIDEC da v1.27, transformando os AARs e exercícios
em um ciclo contínuo de preparação operacional.

A v1.28 acrescenta:

- agenda periódica de exercícios;
- início controlado de exercício a partir da agenda;
- matriz de contatos e escalonamento;
- alertas automáticos de ações corretivas;
- reconhecimento dos alertas;
- lições aprendidas estruturadas;
- dashboard de recorrência entre AARs finalizados;
- inclusão das lições no relatório PDF do exercício.

A v1.28 continua sem executar failover, alteração de DNS, restauração produtiva,
remoção de retenção WORM ou outra ação destrutiva automaticamente.

## Migration

- `0035_sidec_continuity_schedule_escalation_lessons.sql`

Novas tabelas:

- `sidec_continuity_schedules`;
- `sidec_continuity_contacts`;
- `sidec_continuity_action_alerts`;
- `sidec_continuity_lessons`.

## Agenda periódica de exercícios

Tabela:

- `sidec_continuity_schedules`.

Cada agenda possui:

- nome;
- cadência em dias;
- próxima data;
- cenário padrão;
- responsável;
- estado ativo/inativo;
- último exercício originado pela agenda.

Cadência permitida:

- mínimo 7 dias;
- máximo 1095 dias.

Estados calculados na consulta:

- `SCHEDULED`;
- `DUE_SOON`;
- `OVERDUE`;
- `DISABLED`.

Endpoints:

`GET /api/v1/sidec/continuity/schedules`

`POST /api/v1/sidec/continuity/schedules`

`PATCH /api/v1/sidec/continuity/schedules/:id`

### Início de exercício agendado

O endpoint existente de criação de exercício passa a aceitar:

```json
{
  "scheduleId": "<uuid>"
}
```

ou cenário manual:

```json
{
  "scenario": "..."
}
```

Ao iniciar um exercício pela agenda:

1. o SIGDEC exige runbook ativo;
2. impede segundo exercício simultâneo;
3. utiliza o cenário padrão da agenda;
4. cria o exercício apenas após ação humana;
5. grava a origem `scheduleId` na auditoria;
6. registra o exercício como último exercício da agenda;
7. avança `next_due_at` para o próximo ciclo.

Se o exercício for iniciado antecipadamente, a agenda avança uma cadência completa
a partir da data originalmente prevista.

Se estiver atrasada por vários ciclos, o SIGDEC avança até a primeira data futura.

A agenda **não inicia exercícios automaticamente**.

## Matriz de escalonamento

Tabela:

- `sidec_continuity_contacts`.

Escopos:

- `INTERNAL`;
- `EXTERNAL`.

Níveis:

- 1 a 5.

Canais:

- `PHONE`;
- `EMAIL`;
- `RADIO`;
- `OTHER`.

Campos:

- nome;
- função;
- organização;
- nível de escalonamento;
- tipo de canal;
- valor do contato;
- observações;
- ativo/inativo.

Endpoints:

`GET /api/v1/sidec/continuity/contacts`

`POST /api/v1/sidec/continuity/contacts`

`PATCH /api/v1/sidec/continuity/contacts/:id`

Contatos desativados permanecem no histórico administrativo.

## Alertas de ações corretivas

Tabela:

- `sidec_continuity_action_alerts`.

Tipos:

- `DUE_SOON`;
- `OVERDUE`.

Variáveis:

```env
SIDEC_CONTINUITY_ACTION_DUE_SOON_HOURS=72
SIDEC_CONTINUITY_ACTION_ALERT_MINUTES=60
```

Padrão:

- alerta de proximidade: 72 horas;
- avaliação: 60 minutos.

O servidor executa o avaliador:

1. ao iniciar;
2. periodicamente.

Apenas ações com:

- status `OPEN` ou `IN_PROGRESS`;
- prazo definido;

participam da avaliação.

### Idempotência

A constraint única usa:

- ação;
- tipo de alerta;
- prazo.

Assim, a mesma condição não gera alertas duplicados.

Se o prazo da ação mudar antes da finalização do AAR, o novo prazo pode gerar um
novo alerta e o antigo deixa de aparecer como alerta operacional válido.

Ações concluídas ou canceladas não aparecem na fila aberta.

Endpoints:

`GET /api/v1/sidec/continuity/action-alerts`

`PATCH /api/v1/sidec/continuity/action-alerts/:id/ack`

O reconhecimento do alerta não conclui nem altera a ação corretiva.

## Lições aprendidas estruturadas

Tabela:

- `sidec_continuity_lessons`.

Categorias:

- `PROCESS`;
- `PEOPLE`;
- `TECHNOLOGY`;
- `COMMUNICATION`;
- `DATA`;
- `STORAGE`;
- `CONNECTIVITY`;
- `OTHER`.

Severidades:

- `LOW`;
- `MEDIUM`;
- `HIGH`;
- `CRITICAL`.

Cada lição possui:

- categoria;
- chave de recorrência;
- título;
- observação;
- severidade.

Exemplo de chave:

`contato.desatualizado`

A chave deve ser deliberadamente escolhida pelo operador.

O SIGDEC não tenta inferir recorrência por análise subjetiva de texto livre.

## Imutabilidade do AAR

Lições só podem ser adicionadas enquanto o AAR está:

- `DRAFT`.

Depois do AAR:

- `FINAL`;

não é possível adicionar novas lições pela API.

Isso mantém coerência com a imutabilidade do AAR final.

Endpoint:

`POST /api/v1/sidec/continuity/exercises/:id/aar/lessons`

## Dashboard de recorrência

Endpoint:

`GET /api/v1/sidec/continuity/lessons`

Retorna:

- resumo por `recurrenceKey`;
- categoria;
- número de ocorrências;
- data da última ocorrência;
- títulos associados;
- lista recente de lições.

O resumo de recorrência considera somente AARs:

- `FINAL`.

Lições de AARs ainda em rascunho aparecem apenas na lista recente e não são
tratadas como aprendizado consolidado.

## Relatório PDF do exercício

O relatório da v1.27 passa a incluir:

- ações corretivas;
- lições aprendidas estruturadas;
- categoria;
- chave de recorrência;
- severidade;
- observação.

Endpoint permanece:

`GET /api/v1/sidec/continuity/exercises/:id/report.pdf`

## Centro de Continuidade

A rota:

`/continuidade`

passa a exibir:

### Agenda periódica

- próxima data;
- cadência;
- responsável;
- estado da agenda;
- cenário;
- iniciar exercício agendado;
- pausar/reativar agenda;
- cadastrar nova agenda.

### Matriz de escalonamento

- nível;
- contato;
- função;
- organização;
- canal;
- ativar/desativar;
- cadastrar contato.

### Alertas de ações

- ação;
- prioridade;
- responsável;
- prazo;
- `DUE_SOON` ou `OVERDUE`;
- reconhecimento do alerta.

### Lições recorrentes

- chave de recorrência;
- categoria;
- quantidade de ocorrências;
- última ocorrência;
- títulos associados.

### AAR

Enquanto o AAR estiver em rascunho, também é possível registrar uma lição
estruturada diretamente no exercício selecionado.

## Auditoria

São auditados:

- criação de agenda;
- alteração de agenda;
- criação de contato;
- alteração de contato;
- reconhecimento de alerta;
- criação de lição;
- origem agendada de um exercício.

## Permissões

Novas permissões:

- `sidec_continuity_schedule.manage`;
- `sidec_continuity_contacts.manage`;
- `sidec_continuity_lessons.manage`.

O papel `MASTER` recebe essas permissões na migration.

Consultas utilizam:

- `sidec_continuity.read`.

Condução de exercícios e reconhecimento de alertas continua usando:

- `sidec_continuity.manage`.

## Segurança e governança

- agenda não inicia failover;
- contato externo é cadastro administrativo, não mecanismo automático de envio;
- alerta de prazo não muda o status da ação;
- lição recorrente depende de chave estruturada escolhida pelo operador;
- somente AAR final entra no dashboard de recorrência;
- exercício agendado ainda requer decisão humana para início;
- responsáveis de agenda precisam pertencer à organização.

## Testes

A v1.28 valida:

- migration `0035`;
- criação das quatro novas tabelas;
- constraints de contatos;
- constraints de alertas;
- categorias/severidades das lições;
- typecheck das novas rotas e interface;
- migrations em PostgreSQL/PostGIS;
- testes de integração;
- build completo.

## Próxima evolução sugerida

- runbooks técnicos especializados para banco, aplicação, storage e conectividade;
- vínculo de ações corretivas a riscos e projetos de recuperação;
- lembretes externos opcionais por e-mail/integração autorizada;
- agenda integrada ao calendário institucional;
- métricas de tempo médio para encerramento das ações;
- análise histórica de eficácia das ações corretivas;
- revisão periódica da matriz de contatos com confirmação de validade.
