#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/infra/homolog"

if [[ ! -f .env ]]; then
  echo "ERRO: crie infra/homolog/.env a partir de .env.example e preencha os segredos."
  exit 1
fi

set -a
source .env
set +a

required=(
  SIGDEC_DOMAIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  JWT_SECRET MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  SIGDEC_ORG_NAME SIGDEC_ORG_SLUG
  SIGDEC_MASTER_MATRICULA SIGDEC_MASTER_NAME SIGDEC_MASTER_PASSWORD
)

for key in "${required[@]}"; do
  if [[ -z "${!key:-}" || "${!key}" == CHANGE_ME* ]]; then
    echo "ERRO: variável $key ausente ou ainda com placeholder."
    exit 1
  fi
done

if ! docker network inspect sgr_default >/dev/null 2>&1; then
  echo "ERRO: rede Docker externa sgr_default não encontrada."
  echo "O proxy de borda compartilhado deve estar ativo antes do SIGDEC."
  exit 1
fi

echo "[1/5] Build dos containers"
docker compose --env-file .env build

echo "[2/5] Banco e dependências"
docker compose --env-file .env up -d postgres redis minio

echo "[3/5] Migrações PostgreSQL/PostGIS"
docker compose --env-file .env run --rm api node apps/api/dist/scripts/migrate.js

echo "[4/5] Provisionamento idempotente do Master"
docker compose --env-file .env run --rm api node apps/api/dist/scripts/bootstrap-master.js

echo "[5/5] Aplicação"
docker compose --env-file .env up -d api web

docker compose --env-file .env ps
echo
echo "SIGDEC homologação preparado para: https://$SIGDEC_DOMAIN"
