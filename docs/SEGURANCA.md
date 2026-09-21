# Segurança

A conta Master será provisionada no ambiente de implantação e nunca hardcoded no repositório público.

Controles mínimos: Argon2id, MFA para Master/administradores/aprovadores de alertas, bloqueio progressivo, sessões revogáveis, RBAC, auditoria append-only, rate limiting, proteção de uploads, segredos fora do Git, backups criptografados e ambientes separados.

Dados socioassistenciais, população afetada, voluntários e documentos técnicos serão segmentados pelo princípio do menor privilégio.
