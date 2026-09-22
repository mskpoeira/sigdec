# Homologacao no servidor

Topologia: Caddy/HTTPS -> Web Next.js + API Fastify -> PostgreSQL/PostGIS, Redis e MinIO em rede interna Docker.

## Primeira instalacao

No servidor Linux:

1. Obter acesso administrativo SSH.
2. Clonar o repositorio em `/opt/sigdec`.
3. Executar `sudo bash infra/homolog/bootstrap-host.sh`.
4. Na primeira execucao, o script cria `infra/homolog/.env` com permissao 600 e interrompe antes de subir o sistema.
5. Preencher somente no servidor os segredos, os dados da organizacao e o primeiro Master.
6. Executar novamente `sudo bash infra/homolog/bootstrap-host.sh`.

O deploy executa build, PostgreSQL/PostGIS, migracoes idempotentes, bootstrap do Master, Web/API e Caddy com HTTPS.

## Deploy automatico pelo GitHub Actions

O workflow `.github/workflows/deploy-homolog.yml` roda apos CI bem-sucedida em `main` e usa o ambiente GitHub `homologacao`.

Segredos exigidos no GitHub Environment:
- `HOMOLOG_SSH_HOST`
- `HOMOLOG_SSH_PORT`
- `HOMOLOG_SSH_USER`
- `HOMOLOG_SSH_PRIVATE_KEY`
- `HOMOLOG_SSH_KNOWN_HOSTS`
- `HOMOLOG_PUBLIC_URL`

O servidor deve possuir o repositorio em `/opt/sigdec` e o arquivo `.env` configurado. Depois disso, cada CI aprovada em `main` pode atualizar a homologacao automaticamente.

## Seguranca

- Nunca versionar `.env`.
- Banco, Redis e MinIO nao sao publicados para a internet.
- Nao desabilitar verificacao de host SSH; use `HOMOLOG_SSH_KNOWN_HOSTS`.
- A chave de deploy deve ter acesso somente ao servidor necessario.
- A conta Master deve trocar a senha inicial e ativar MFA.
