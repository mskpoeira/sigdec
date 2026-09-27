# Padrão global de ciclo de vida dos cadastros

Todo cadastro editável criado no SIGDEC deve declarar explicitamente as ações disponíveis ao usuário autorizado.

## Ações padrão
- **✍️ Editar** — altera os campos permitidos, preservando auditoria.
- **🗄️ Arquivar** — retira o registro da operação ativa sem apagar dados.
- **♻️ Restaurar** — devolve um registro arquivado à operação ativa.
- **➖ Excluir** — remove da operação conforme a política de retenção da entidade.

## Regra de segurança
Excluir não significa necessariamente DELETE físico. Registros vinculados a ocorrências, documentos emitidos, auditoria, estoque, evidências, integrações, protocolos ou outros dados que exijam rastreabilidade devem usar exclusão lógica, cancelamento, inativação ou ação equivalente.

## Interface
Usar o componente `RecordActions` de `apps/web/app/lib/record-actions.tsx`. Não criar variantes locais sem necessidade técnica.

## Backend
Cada entidade deve:
1. validar organização/tenant;
2. exigir permissão específica;
3. registrar alteração relevante em `audit_logs`;
4. impedir exclusão que quebre integridade referencial;
5. diferenciar arquivamento de exclusão;
6. permitir restauração de arquivado quando aplicável;
7. omitir arquivados/excluídos das listas operacionais por padrão;
8. oferecer filtro/consulta histórica quando aplicável.

## Exceções
Eventos imutáveis e trilhas históricas não devem receber exclusão destrutiva. Exemplos: audit logs, versões emitidas, movimentações consolidadas, evidências seladas e eventos de integração. A interface deve oferecer apenas ações compatíveis com a natureza do registro.

## Critério para funcionalidade nova
Nenhum novo cadastro é considerado completo sem:
- criação;
- consulta/listagem;
- edição quando semanticamente permitida;
- arquivamento/restauração quando aplicável;
- exclusão/inativação quando aplicável;
- autorização;
- auditoria;
- confirmação para ações destrutivas;
- teste do ciclo de vida.


## Reaproveitamento de cadastro por telefone
Todo cadastro de pessoa que possua telefone deve, quando houver fonte interna autorizada, consultar o SIGDEC pelo número normalizado após DDD+número completo.

Regras:
- a busca é interna ao SIGDEC; não realizar reverse lookup externo de pessoa;
- ignorar máscara e pontuação do telefone;
- respeitar organização e permissões do usuário;
- exibir a pessoa encontrada antes de preencher;
- exigir ação afirmativa do operador ("Usar dados") e confirmação;
- nunca sobrescrever silenciosamente dados digitados;
- se houver múltiplas correspondências, permitir escolher;
- preencher apenas campos compatíveis e autorizados;
- o operador deve revisar os dados antes de salvar;
- não retornar registros logicamente excluídos;
- a ausência de correspondência não pode impedir um novo cadastro.
