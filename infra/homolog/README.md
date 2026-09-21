# Deploy de homologação no servidor

Este ambiente foi desenhado para um servidor Linux com Docker Engine e Docker Compose v2.

## Topologia

- Caddy: HTTPS e reverse proxy
- Web: Next.js
- API: Fastify
- PostgreSQL 16 + PostGIS
- Redis
- MinIO

Somente as portas 80 e 443 precisam ficar públicas. Banco, Redis, MinIO e API permanecem na rede interna Docker.

## Primeira instalação

1. Instalar Docker Engine + Compose v2.
2. Clonar o repositório.
3. Copiar `.env.example` para `.env`.
4. Gerar segredos fortes localmente no servidor.
5. Confirmar que o DNS do domínio aponta para o servidor.
6. Executar:
   `chmod +x deploy.sh && ./deploy.sh`

O script:
- constrói os containers;
- sobe PostgreSQL/PostGIS, Redis e MinIO;
- executa todas as migrações pendentes;
- provisiona o primeiro Master de forma idempotente;
- sobe API, Web e Caddy;
- solicita HTTPS automaticamente via Caddy quando o DNS estiver válido.

## Master

A matrícula configurada pode conter máscara (ex.: 915.789), mas o login interno é normalizado para 915789.

A senha inicial fica apenas em `.env` no servidor, nunca no GitHub. Após o primeiro acesso, deverá ser trocada; MFA será exigido quando o fluxo estiver concluído.

## Atualizações

No diretório do repositório:

`git pull --ff-only`

Depois execute novamente:

`infra/homolog/deploy.sh`

As migrações já aplicadas são registradas em `schema_migrations` e não são repetidas.

## Backup mínimo recomendado

Antes de homologação com dados relevantes, automatizar:
- dump PostgreSQL;
- cópia do volume MinIO;
- retenção externa ao próprio servidor;
- teste periódico de restauração.
