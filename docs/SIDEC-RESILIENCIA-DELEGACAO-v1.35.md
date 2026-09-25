# SIGDEC v1.35 — Resiliência WORM e delegação temporária

## Objetivo

A v1.35 reforça a governança das mudanças do runbook SIDEC em dois pontos: redundância dos relatórios selados e continuidade formal da função de aprovação crítica.

## Réplica WORM dos relatórios

O PDF final de uma mudança, depois de verificado, selado e arquivado no WORM principal, pode ser replicado para o destino WORM secundário já configurado no SIGDEC.

A réplica:

- usa a mesma identidade de conteúdo SHA-256 do relatório;
- preserva a versionId retornada pelo armazenamento;
- registra bucket, object key, modo Object Lock, retenção e legal hold;
- possui histórico próprio de verificações remotas;
- é conferida por recálculo SHA-256 após a gravação;
- participa da verificação periódica executada pelo timer WORM do SIGDEC.

A funcionalidade utiliza as configurações existentes SIDEC_WORM_REPLICA_*. Quando a réplica não está habilitada, o sistema informa o estado sem simular redundância.

## Preservação monotônica

A v1.35 permite ampliar a retenção do relatório principal após o arquivamento.

Não existe operação para reduzir o prazo já observado. Uma solicitação de retenção igual ou anterior ao estado remoto retorna RETENTION_MUST_ONLY_INCREASE.

Também é possível ativar legal hold. A v1.35 não implementa liberação automática ou manual do legal hold.

Cada aumento de preservação registra um evento append-only contendo destino, estado anterior, novo estado, fundamento, responsável, data e hora.

Depois de uma ampliação no WORM principal, o SIGDEC tenta sincronizar a política da réplica secundária sem reduzir qualquer proteção já existente nela.

## Estado efetivo

O recibo do arquivamento principal permanece imutável. Quando a retenção ou o legal hold são ampliados posteriormente, a API e a interface exibem prioritariamente o último estado remoto íntegro verificado. O recibo original continua preservado como prova do arquivamento inicial.

## Delegação temporária de aprovadores

A v1.35 introduz delegação formal e temporária da autoridade de aprovação de mudanças críticas.

Uma delegação contém autoridade delegante, usuário delegado, início e fim da vigência, fundamento, responsável pelo ato e eventual revogação.

Regras:

- não é permitida autodelegação;
- o delegado deve ser usuário ativo da mesma organização;
- a janela máxima de cada delegação é de 90 dias;
- delegações sobrepostas entre o mesmo delegante e delegado são bloqueadas;
- a revogação preserva o histórico;
- uma decisão somente pode usar uma delegação vigente no instante da aprovação.

## Quórum por autoridade

O quórum das mudanças críticas continua exigindo duas aprovações independentes.

A v1.35 passa a identificar cada decisão por authority_user_id. Em aprovação direta, authority_user_id = decided_by. Em aprovação delegada, authority_user_id = delegator_user_id.

Assim, dois usuários que atuem por delegação da mesma autoridade não formam duas aprovações independentes. Para cada autoridade, o sistema considera a decisão mais recente no momento da aplicação.

O proponente continua impedido de autorizar a própria mudança, inclusive indiretamente por meio de um delegado que represente sua autoridade.

## Auditoria

São auditadas criação e revogação de delegação, aprovação direta ou delegada, criação e verificação da réplica WORM, sincronização de política, ampliação de retenção e ativação de legal hold.

## Migration

0042_sidec_continuity_resilience_delegation.sql

Principais objetos:

- sidec_continuity_approval_delegations;
- sidec_continuity_change_approvals.authority_user_id;
- sidec_continuity_change_approvals.delegation_id;
- sidec_continuity_change_report_replicas;
- sidec_continuity_change_report_replica_verifications;
- sidec_continuity_change_report_policy_events;
- permissão sidec_continuity_change.delegate.

As aprovações anteriores à v1.35 são migradas com authority_user_id = decided_by, preservando o significado histórico das decisões já registradas.

## Interface

O Centro de Continuidade v1.35 passa a exibir delegações vigentes e programadas, criação e revogação de delegação, autoridade originária em decisões delegadas, estado do WORM principal e da réplica, criação e verificação de réplica, sincronização de política, ampliação de retenção, ativação de legal hold e indicadores de réplicas íntegras.

## Garantias

- nenhuma réplica é considerada íntegra sem verificação do hash;
- retenção só aumenta;
- legal hold só aumenta proteção;
- recibos iniciais permanecem imutáveis;
- decisões delegadas não multiplicam artificialmente o quórum;
- uma delegação expirada ou revogada não autoriza nova decisão;
- o histórico administrativo não é apagado pela revogação;
- o autor da proposta não aprova a própria mudança por via direta ou delegada.

## Próxima evolução sugerida

- retry/backoff específico para criação e sincronização das réplicas de relatório;
- drill de restauração do PDF em ambos os destinos WORM;
- metas quantitativas de eficácia por categoria e recorrência;
- linhagem múltipla para divisão e fusão de etapas;
- exportação executiva consolidada de governança por período.