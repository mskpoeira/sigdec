# SIGDEC v1.5 — Documentos técnicos oficiais

## Entregue

- numeração automática anual por tipo de documento;
- modelos institucionais versionados;
- relatórios, pareceres, autos de interdição, declarações e formulários;
- vínculo opcional com ocorrência e vistoria;
- fluxo controlado: rascunho → revisão → aprovação → emissão;
- devolução para correção e cancelamento posterior à emissão;
- histórico imutável de revisões;
- resumo obrigatório das alterações;
- hash SHA-256 por revisão;
- assinatura eletrônica interna de aprovação, emissão e cancelamento;
- identificação do usuário, matrícula, data, IP e agente do navegador;
- geração de PDF A4 com cabeçalho institucional, paginação e integridade;
- marca d'água automática enquanto o documento não estiver emitido;
- fundamentação legal, destinatário e prazo de validade;
- trilha de auditoria de todas as operações;
- permissões distintas para elaborar, revisar, aprovar e emitir.

## Segurança jurídica

A assinatura registrada nesta fase é uma assinatura eletrônica interna do SIGDEC,
vinculada à sessão autenticada e ao hash do conteúdo. Ela preserva autoria,
integridade e rastreabilidade dentro do sistema, mas não deve ser apresentada como
certificado digital ICP-Brasil quando a legislação exigir assinatura qualificada.

Documentos emitidos ficam bloqueados para edição. Qualquer correção exige devolução
antes da emissão ou novo documento/revisão conforme o procedimento administrativo.

## Banco de dados

A migração `0012_official_documents.sql`:

- amplia `technical_documents`;
- cria contadores de numeração;
- cria modelos institucionais;
- amplia o histórico de versões;
- cria assinaturas eletrônicas internas;
- adiciona permissões de revisão, aprovação e gestão de modelos.

## Próxima evolução sugerida

A versão seguinte deve operacionalizar o Centro de Gestão: riscos, alertas,
S2iD, treinamentos, recuperação, biblioteca, integrações e indicadores, hoje já
estruturados no banco e na API.
