# SIGDEC v1.35.1 — Saneamento pós-auditoria

## Correções

- permissões críticas são revalidadas no banco em cada operação protegida;
- sessão é recusada quando a organização atual do usuário diverge da organização gravada no token;
- a autoridade de aprovação é validada em tempo real;
- delegações exigem delegado ativo com acesso de leitura à continuidade;
- o mesmo delegado não pode representar duas autoridades em períodos sobrepostos;
- delegação deve terminar no futuro e permanece limitada a 90 dias;
- histórico de verificações WORM e eventos de política passa a ser append-only por trigger;
- conteúdo originário da delegação é imutável e a revogação é definitiva;
- extensão de retenção WORM rejeita data passada;
- testes de schema validam os novos triggers e funções de proteção.

## Objetivo

Eliminar ambiguidades de autoridade, reduzir janela de privilégios revogados e alinhar as garantias declaradas de auditoria com restrições efetivas no banco.
