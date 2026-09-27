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
