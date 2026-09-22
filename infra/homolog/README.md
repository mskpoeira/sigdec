# Homologação no servidor

O servidor já possui um proxy Caddy de borda compartilhado. Para não disputar as portas 80/443, o SIGDEC publica apenas seus containers internos e conecta Web/API à rede Docker externa `sgr_default`.

## Topologia

Internet → Caddy existente → `sigdec-web-homolog` / `sigdec-api-homolog` → PostgreSQL/PostGIS, Redis e MinIO.

PostgreSQL, Redis e MinIO permanecem exclusivos do SIGDEC e não são expostos à internet.

## Primeira instalação

1. Clonar o repositório em `/opt/sigdec`.
2. Criar `infra/homolog/.env` com permissão 600.
3. Confirmar a existência da rede Docker `sgr_default`.
4. Executar `infra/homolog/deploy.sh`.
5. Incorporar `infra/homolog/Caddyfile.fragment` ao proxy de borda e recarregar o Caddy.

O deploy executa build, PostgreSQL/PostGIS, migrações idempotentes, bootstrap do Master e sobe Web/API.

## Master

A matrícula `915.789` é normalizada para `915789`. A senha inicial deve existir somente no servidor/entrega segura e nunca no Git.

## Atualizações

`git pull --ff-only` e depois `infra/homolog/deploy.sh`.

As migrações já aplicadas ficam registradas em `schema_migrations`.
