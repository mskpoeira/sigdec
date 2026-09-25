# SIGDEC v1.33 — Governança crítica, identidade de etapas e selagem

## Objetivo

A v1.33 endurece a governança das mudanças do runbook sem retirar a decisão humana do processo.

O ciclo passa a contar com:

1. identidade persistente das etapas entre revisões;
2. detecção correta de movimentações e mudanças estruturais;
3. dupla aprovação independente para recomendações críticas;
4. perfil específico de aprovador;
5. relatório final selado com SHA-256 e Ed25519;
6. verificação posterior do selo;
7. indicadores consolidados de eficácia e governança.

## Identidade persistente das etapas

A tabela `sidec_continuity_steps` recebe:

- `lineage_key uuid NOT NULL`.

Ao clonar uma revisão ativa, a nova etapa mantém a mesma `lineage_key`.

Ao salvar um rascunho:

- identidades existentes são preservadas;
- etapas novas recebem nova identidade;
- identidades duplicadas na mesma revisão são rejeitadas;
- identidades estranhas à linhagem do runbook são rejeitadas.

O diff passa a comparar etapas pela `lineage_key`.

Assim, alterar:

- fase;
- posição;
- título;
- instruções;
- responsável;
- tempo esperado;
- obrigatoriedade

é registrado como `MODIFIED`, em vez de produzir artificialmente um `REMOVED + ADDED`.

## Governança de mudanças críticas

Uma recomendação com severidade `CRITICAL` exige duas aprovações antes de uma proposta poder passar de:

`PROPOSED → APPLIED`

Regras:

- duas aprovações de usuários distintos;
- o proponente não pode aprovar a própria proposta;
- uma decisão de rejeição vigente bloqueia a aplicação;
- cada aprovador possui uma única decisão vigente por proposta;
- a decisão pode ser atualizada enquanto a proposta permanecer `PROPOSED`;
- todas as decisões geram auditoria.

O sistema não decide automaticamente se uma mudança deve ser aprovada.

## Perfil de aprovador

Novo papel sistêmico:

- `SIDEC_CONTINUITY_APPROVER`;
- nome: **Aprovador de Mudança SIDEC**.

Permissões:

- leitura da continuidade;
- aprovação/rejeição de mudança crítica.

Esse perfil não recebe privilégios gerais de Master.

O Master continua com permissão de aprovação e de selagem.

## Selagem do relatório

Uma proposta em `VERIFIED` pode ter seu relatório final selado.

Endpoint:

`POST /api/v1/sidec/continuity/runbook/change-proposals/:id/report/seal`

O SIGDEC:

1. gera o PDF final;
2. calcula SHA-256 dos bytes;
3. vincula criptograficamente:
   - hash do relatório;
   - ID da proposta;
   - ID da revisão-alvo;
   - instante de selagem;
4. assina o payload com Ed25519;
5. guarda:
   - PDF;
   - hash;
   - algoritmo;
   - key ID;
   - assinatura;
   - chave pública;
   - fingerprint;
   - responsável;
   - instante.

A linha de selo é imutável por trigger de banco.

Depois da selagem, o endpoint de PDF devolve os bytes armazenados, e não uma nova renderização.

## Verificação do selo

Endpoint:

`GET /api/v1/sidec/continuity/runbook/change-proposals/:id/report/seal`

A verificação recalcula o SHA-256 do PDF armazenado e valida a assinatura Ed25519 com a chave pública preservada.

Retorna separadamente:

- `hashValid`;
- `signatureValid`;
- `valid`.

Nenhum segredo privado é necessário para a conferência da assinatura histórica.

## Relatório

O PDF da mudança passa a registrar:

- severidade;
- proposta e fundamentação;
- aprovações de governança;
- revisão-base e revisão-alvo;
- diff de campos;
- diff das etapas por identidade persistente;
- evidências;
- eficácia antes/depois;
- autoria;
- nota de governança.

## Indicadores

Novo endpoint:

`GET /api/v1/sidec/continuity/runbook/change-metrics`

Resumo:

- total de propostas;
- propostas, aplicadas, verificadas e canceladas;
- mudanças críticas;
- relatórios selados;
- melhorou / estável / regrediu / sem baseline;
- taxa de verificação;
- taxa de melhora;
- tempo médio até aplicação;
- tempo médio entre aplicação e verificação.

Também são retornados recortes:

- por severidade;
- por mês, nos últimos 12 meses.

## Interface

O Centro de Continuidade exibe:

- versão 1.33;
- indicadores de governança e eficácia;
- severidade da recomendação;
- situação do quorum crítico;
- decisões e respectivos responsáveis;
- ações de aprovar/rejeitar;
- bloqueio visual da aplicação enquanto faltar quorum;
- estado de selagem;
- SHA-256 resumido;
- key ID;
- ação de verificação do selo;
- PDF selado.

## Migration

- `0040_sidec_continuity_step_identity_critical_seals.sql`

Principais estruturas:

- `sidec_continuity_steps.lineage_key`;
- `sidec_continuity_change_approvals`;
- `sidec_continuity_change_report_seals`;
- trigger de imutabilidade;
- papel `SIDEC_CONTINUITY_APPROVER`.

## Garantias

- alteração de posição não perde a identidade da etapa;
- mudança crítica não pode ser aplicada sem quorum;
- proponente não compõe o próprio quorum;
- rejeição bloqueia aplicação;
- aprovação não modifica automaticamente o runbook;
- o relatório só pode ser selado após verificação;
- o PDF selado é imutável;
- o hash detecta alteração dos bytes;
- a assinatura Ed25519 comprova autenticidade criptográfica do selo;
- decisões relevantes permanecem auditadas.

## Próxima evolução sugerida

- arquivamento opcional do relatório selado no WORM;
- política temporal para expiração/revalidação de aprovações;
- delegação formal de aprovadores;
- tratamento explícito de divisão ou fusão de etapas;
- metas mínimas de eficácia por categoria;
- painel executivo de tendências e reincidência.
