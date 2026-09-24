# SIGDEC v1.29 — Ações corretivas integradas e eficácia histórica

## Objetivo

Evoluir o ciclo de melhoria contínua dos exercícios de continuidade SIDEC,
conectando as ações corretivas do AAR aos módulos de riscos e recuperação do
SIGDEC e permitindo avaliação humana posterior da eficácia.

A v1.29 acrescenta:

- vínculo opcional de ação corretiva com risco;
- vínculo opcional com ação de recuperação;
- validação de organização nos vínculos;
- preservação da imutabilidade do AAR;
- avaliação posterior de eficácia;
- métricas históricas de execução;
- indicadores de prazo e tempo médio;
- relatório PDF enriquecido com vínculos e eficácia;
- interface operacional no Centro de Continuidade.

## Migration

- `0036_sidec_continuity_action_effectiveness.sql`

Novos campos em:

- `sidec_continuity_action_items`

Campos:

- `risk_id`;
- `recovery_action_id`;
- `effectiveness`;
- `effectiveness_notes`;
- `effectiveness_evaluated_at`;
- `effectiveness_evaluated_by`.

## Estados de eficácia

Valores permitidos:

- `NOT_EVALUATED`;
- `EFFECTIVE`;
- `PARTIAL`;
- `INEFFECTIVE`.

Ações existentes recebem:

- `NOT_EVALUATED`.

## Regra de governança

A eficácia só pode ser diferente de `NOT_EVALUATED` quando a ação estiver:

- `DONE`.

A própria migration possui constraint para essa relação.

O SIGDEC não infere eficácia por texto, tempo ou resultado do exercício.

A classificação é deliberadamente registrada por um operador.

## Vínculos com riscos

Durante o AAR em rascunho, uma ação corretiva pode apontar para um registro em:

- `risk_registers`.

O SIGDEC verifica:

- existência;
- mesma organização.

Na interface são apresentados:

- código;
- título;
- categoria;
- probabilidade;
- impacto;
- score `probabilidade × impacto`.

O vínculo não altera automaticamente:

- score;
- status;
- mitigação;
- ciclo de vida do risco.

## Vínculos com recuperação

Uma ação corretiva também pode apontar para:

- `recovery_actions`.

O SIGDEC valida a mesma organização.

O vínculo não muda automaticamente o status da ação de recuperação.

A integração serve para rastreabilidade entre:

- exercício;
- AAR;
- ação corretiva;
- plano de recuperação.

## Imutabilidade do AAR

Enquanto o AAR está:

- `DRAFT`

podem ser definidos ou alterados:

- título;
- descrição;
- prioridade;
- responsável;
- prazo;
- risco relacionado;
- ação de recuperação relacionada.

Após:

- `FINAL`

esses campos ficam congelados.

Mesmo após a finalização, continua permitido:

- iniciar execução;
- concluir ação;
- registrar eficácia.

Essas mudanças pertencem ao acompanhamento posterior, não à edição do AAR.

## Avaliação de eficácia

Endpoint:

`PATCH /api/v1/sidec/continuity/exercises/:exerciseId/aar/actions/:actionId/effectiveness`

Payload:

```json
{
  "effectiveness": "EFFECTIVE",
  "notes": "A correção eliminou a causa observada no exercício seguinte."
}
```

Pré-condição:

- ação em `DONE`.

São auditados:

- avaliador;
- data/hora;
- resultado;
- fundamentação;
- estado anterior.

## Referências disponíveis

Endpoint:

`GET /api/v1/sidec/continuity/action-references`

Retorna:

- riscos da organização;
- ações de recuperação da organização.

A rota utiliza permissão de leitura de continuidade para permitir uso integrado
no próprio Centro de Continuidade sem exigir que o operador navegue por outro
módulo.

## Métricas históricas

Endpoint:

`GET /api/v1/sidec/continuity/actions/metrics`

Resumo:

- total de ações;
- concluídas;
- vencidas;
- vínculos com riscos;
- vínculos com recuperação;
- tempo médio de conclusão em horas;
- percentual concluído dentro do prazo;
- quantidade eficaz;
- quantidade parcial;
- quantidade ineficaz;
- concluídas aguardando avaliação.

Também retorna agregação por prioridade.

### Tempo médio

Calculado entre:

- `created_at`;
- `completed_at`.

A métrica representa duração registrada no SIGDEC.

Ela não é usada para classificar automaticamente eficácia.

### Percentual no prazo

Considera somente ações:

- `DONE`;
- com `due_at` definido.

É considerada no prazo quando:

`completed_at <= due_at`

## Centro de Continuidade

A rota:

`/continuidade`

passa a exibir uma seção de:

- desempenho das ações corretivas.

Cards:

- total / concluídas / vencidas;
- tempo médio;
- percentual no prazo;
- eficácia;
- integrações com riscos e recuperação.

## Ações corretivas

Cada card passa a mostrar, quando existentes:

- risco relacionado;
- código do risco;
- ação de recuperação;
- status da recuperação;
- resultado de eficácia;
- fundamentação da eficácia.

Para uma ação `DONE`, a interface permite:

- Eficaz;
- Parcial;
- Ineficaz;
- fundamentação textual.

## Criação de ação

O formulário passa a permitir:

- selecionar um risco;
- selecionar uma ação de recuperação.

Ambos são opcionais.

A ação pode estar ligada:

- somente a risco;
- somente a recuperação;
- a ambos;
- a nenhum.

## Relatório PDF do exercício

O relatório passa a incluir, no plano de ações:

- risco relacionado;
- ação de recuperação relacionada;
- status da recuperação;
- eficácia;
- observação da eficácia.

Isso mantém o relatório coerente com o acompanhamento posterior da ação.

## Segurança e consistência

- referências são validadas por organização;
- FK usa `ON DELETE SET NULL`;
- exclusão de risco/recuperação não apaga a ação corretiva;
- vínculos não executam mudanças automáticas nos módulos relacionados;
- conteúdo do AAR final continua imutável;
- eficácia exige ação concluída;
- avaliação é humana e auditável.

## Testes

A v1.29 valida:

- migration `0036`;
- novas colunas;
- FKs para risco e recuperação;
- enum lógico de eficácia;
- constraint eficácia ↔ status DONE;
- typecheck das rotas;
- typecheck da interface;
- migration em PostgreSQL/PostGIS;
- testes de integração;
- build completo.

## Próxima evolução sugerida

- criar ações de recuperação diretamente a partir de uma ação corretiva, com confirmação humana;
- transformar risco recorrente em item recomendado para revisão do runbook;
- comparar eficácia de ações entre exercícios subsequentes;
- métricas por categoria de lição e recorrência;
- lembretes externos opcionais por e-mail;
- integração futura com calendário institucional.
