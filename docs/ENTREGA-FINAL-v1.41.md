# SIGDEC v1.41 — Fechamento de entrega

## Estado da entrega

A v1.41 fecha os requisitos operacionais e de segurança que permaneciam abertos após a v1.40.

### Segurança de acesso

- matrícula + senha;
- política de senha forte;
- bloqueio por tentativas inválidas;
- recuperação de senha por e-mail;
- sessão revogável e revalidação de permissões no banco;
- MFA TOTP para perfis estratégicos (nível de papel >= `MFA_STRATEGIC_ROLE_LEVEL`, padrão 80);
- Master sempre marcado como MFA obrigatório;
- QR Code/URI `otpauth://` compatível com aplicativos TOTP;
- segredo TOTP cifrado em repouso com AES-256-GCM;
- 10 códigos de recuperação de uso único, armazenados somente por hash;
- challenge MFA de curta duração, máximo de 5 tentativas;
- sessões estratégicas só são válidas quando possuem `mfa_verified_at`;
- elevação de papel durante uma sessão passa a exigir MFA imediatamente.

A chave `MFA_ENCRYPTION_KEY` deve ser configurada antes do primeiro cadastro MFA em produção e mantida estável. Se ausente, a aplicação deriva a chave criptográfica do `JWT_SECRET` para compatibilidade.

## Webhooks

Integrações do tipo `WEBHOOK` agora possuem entrega efetiva.

### Segurança

- endpoint remoto HTTPS obrigatório em produção;
- bloqueio de destinos locais/privados por hostname/IP resolvido;
- redirects HTTP não são seguidos;
- timeout de 10 segundos;
- segredo aleatório de 256 bits por webhook;
- segredo cifrado em repouso;
- assinatura HMAC-SHA256 no formato:
  - `X-SIGDEC-Timestamp`;
  - `X-SIGDEC-Signature: sha256=<hex>`;
  - mensagem assinada: `<timestamp>.<corpo-json>`;
- segredo exibido somente na criação/rotação;
- rotação inicia uma nova janela de emissão, evitando replay do histórico antigo.

### Entrega e resiliência

- fila persistente `webhook_deliveries`;
- eventos derivados da trilha de auditoria da organização;
- filtro opcional por prefixo de ação;
- dados `before/after` desabilitados por padrão;
- retry exponencial, máximo de 10 tentativas;
- histórico de HTTP status, erro e trecho de resposta;
- teste manual pela Administração;
- indicadores de pendências, falhas e última entrega.

## Fechamentos anteriores já incorporados

- v1.39: estoque/entregas humanitárias com baixa e alerta de duplicidade, cadastro ampliado de voluntários, feature flags, administração de integrações e painel sem indicadores fictícios;
- v1.40: PWA de campo, operação offline segura, sincronização de posição pendente, backup PostgreSQL pré-deploy e restore drill automático;
- v1.38.1: CI reproduzível, audit de dependências e correção de vulnerabilidades de produção;
- v1.35–v1.38: governança SIDEC, WORM, resiliência, linhagem múltipla e metas executivas.

## Migration

`0048_mfa_webhooks.sql`

Adiciona:

- `auth_sessions.mfa_verified_at`;
- `mfa_login_challenges`;
- exigência de MFA para papéis estratégicos existentes;
- campos de segredo/estado de webhook em `integration_endpoints`;
- `webhook_deliveries` com fila/retry.

## Critério de aceite

A entrega somente é considerada pronta quando:

1. CI com lockfile congelado e `pnpm audit --prod --audit-level=high` estiver verde;
2. typecheck, testes unitários, migrations e testes de integração estiverem verdes;
3. build Web/API estiver verde;
4. deploy de homologação executar backup + restore drill, migrations e bootstrap;
5. `/health` responder com a versão 1.41.0;
6. auditoria final não identificar erro material aberto.
