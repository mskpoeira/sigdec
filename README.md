# SIGDEC — Sistema Integrado de Gestão da Defesa Civil

Plataforma municipal modular para prevenção, preparação, monitoramento, alertamento, atendimento, despacho, comando, resposta, assistência humanitária, voluntariado, logística, documentação, recuperação e gestão de riscos e desastres.

## Princípios

- **Modular por permissão:** cada perfil enxerga somente o necessário.
- **API-first:** integrações externas sem acoplamento ao frontend.
- **Offline-first no campo:** PWA preparada para operação degradada.
- **Auditoria total:** atos relevantes possuem autor, data/hora e trilha imutável.
- **LGPD e menor privilégio:** dados pessoais e sensíveis aparecem somente para perfis autorizados.
- **Multi-município:** sem regras hardcoded para uma única prefeitura.
- **Integração, não substituição:** sistemas especializados existentes podem ser conectados ao SIGDEC.

## Stack

- Node.js 22+
- TypeScript
- Next.js
- Fastify
- PostgreSQL + PostGIS
- Redis
- MinIO/S3
- Docker Compose
- Caddy em homologação
- pnpm workspaces

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Suba a infraestrutura: `docker compose up -d`.
3. Instale dependências: `pnpm install`.
4. Execute `pnpm --filter @sigdec/api db:migrate`.
5. Configure o bootstrap do primeiro Master somente no ambiente seguro.
6. Rode `pnpm dev`.

## Homologação em servidor

Consulte `infra/homolog/README.md`. O ambiente inclui PostgreSQL/PostGIS, Redis, MinIO, API, Web e Caddy/HTTPS.

> Nunca coloque senhas, chaves, CPF, dados reais de cidadãos ou credenciais de produção no Git.

## Licença

GNU Affero General Public License v3.0 — consulte [LICENSE](./LICENSE).
