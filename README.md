# SIGDEC — Sistema Integrado de Gestão da Defesa Civil

Plataforma municipal modular para prevenção, preparação, monitoramento, alertamento, atendimento, despacho, comando, resposta, assistência humanitária, voluntariado, logística, documentação, recuperação e gestão de riscos e desastres.

## Princípios

- **Modular por permissão:** cada perfil enxerga somente o necessário.
- **API-first:** integrações externas sem acoplamento ao frontend.
- **Offline-first no campo:** PWA preparada para operação degradada.
- **Auditoria total:** atos relevantes possuem autor, data/hora e trilha imutável.
- **LGPD e menor privilégio:** dados pessoais e sensíveis aparecem somente para perfis autorizados.
- **Multi-município:** sem regras hardcoded para uma única prefeitura.
- **Integração, não substituição:** sistemas especializados existentes, como monitoramento ambiental, podem ser conectados ao SIGDEC.

## Módulos previstos

Central 199 e ocorrências, despacho, equipes e viaturas, campo e vistorias, laudos e documentos, riscos, monitoramento, alertas, SCO, assistência humanitária, abrigos, Fundo Social, doações, voluntariado, logística, recursos, comunicações, S2iD/COBRADE, treinamento, simulados, recuperação, biblioteca institucional, BI, auditoria e integrações.

## Stack inicial

- Node.js 22+
- TypeScript
- Next.js (web)
- Fastify (API)
- PostgreSQL + PostGIS
- Redis
- MinIO/S3 compatível para anexos
- Docker Compose
- pnpm workspaces

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Suba a infraestrutura: `docker compose up -d`.
3. Instale dependências: `pnpm install`.
4. Execute a migração `db/migrations/0001_foundation.sql`.
5. Configure o bootstrap do primeiro Master somente no ambiente do servidor.
6. Rode `pnpm dev`.

> Nunca coloque senhas, chaves, CPF, dados de cidadãos ou credenciais de produção no Git.

## Licença

GNU Affero General Public License v3.0 — consulte [LICENSE](./LICENSE).
