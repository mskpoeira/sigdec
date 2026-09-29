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

echo "[1/7] Build dos containers"
docker compose --env-file .env build

echo "[2/7] Banco e dependências"
docker compose --env-file .env up -d postgres redis minio

echo "[3/7] Aguardar PostgreSQL e executar backup/restauração"
for i in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' sigdec-postgres-homolog 2>/dev/null || true)"
  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "ERRO: PostgreSQL não ficou saudável."
    docker logs --tail 120 sigdec-postgres-homolog || true
    exit 1
  fi
  sleep 2
done
chmod +x backup-restore-drill.sh
./backup-restore-drill.sh

echo "[4/7] Migrações PostgreSQL/PostGIS"
docker compose --env-file .env run --rm api node apps/api/dist/scripts/migrate.js

echo "[5/7] Provisionamento idempotente do Master"
docker compose --env-file .env run --rm api node apps/api/dist/scripts/bootstrap-master.js

echo "[6/7] Provisionamento idempotente do efetivo da Defesa Civil"
docker compose --env-file .env run --rm api node apps/api/dist/scripts/bootstrap-defesa-civil-users.js

echo "[7/7] Aplicação e proxy exclusivo"
docker compose --env-file .env up -d api web caddy

docker compose --env-file .env ps
echo
echo "SIGDEC homologação iniciado em runtime isolado."
echo "HTTP local: ${SIGDEC_HTTP_BIND:-127.0.0.1:28080}"
echo "HTTPS local: ${SIGDEC_HTTPS_BIND:-127.0.0.1:28443}"
