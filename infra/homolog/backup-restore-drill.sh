#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/infra/homolog"

if [[ ! -f .env ]]; then
  echo "ERRO: infra/homolog/.env ausente."
  exit 1
fi

set -a
source .env
set +a

BACKUP_DIR="${SIGDEC_BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
RETENTION_DAYS="${SIGDEC_BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

exists="$(docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | tr -d '[:space:]')"
if [[ "$exists" != "t" ]]; then
  echo "Banco ainda não migrado; backup pré-deploy dispensado na primeira instalação."
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUP_DIR/${POSTGRES_DB}_${stamp}.dump"
drill_db="sigdec_restore_drill_${stamp//[^0-9A-Za-z]/_}"

cleanup() {
  docker compose --env-file .env exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$drill_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Criando backup PostgreSQL: $backup"
docker compose --env-file .env exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$backup"
chmod 600 "$backup"
test -s "$backup"

echo "Validando catálogo do backup"
docker compose --env-file .env exec -T postgres pg_restore --list < "$backup" >/dev/null

echo "Executando restore drill em banco temporário"
docker compose --env-file .env exec -T postgres createdb -U "$POSTGRES_USER" "$drill_db"
docker compose --env-file .env exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$drill_db" --no-owner --no-privileges < "$backup"

migration_count="$(docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$drill_db" -Atqc "SELECT count(*) FROM schema_migrations" | tr -d '[:space:]')"
critical_tables="$(docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$drill_db" -Atqc "SELECT count(*) FROM (VALUES ('users'),('incidents'),('audit_logs'),('humanitarian_items'),('volunteers')) v(name) WHERE to_regclass('public.'||name) IS NOT NULL" | tr -d '[:space:]')"

if [[ -z "$migration_count" || "$migration_count" -lt 1 || "$critical_tables" -ne 5 ]]; then
  echo "ERRO: restore drill não confirmou esquema crítico."
  exit 1
fi

echo "Restore drill aprovado: $migration_count migrações registradas e $critical_tables tabelas críticas."
cleanup
trap - EXIT

find "$BACKUP_DIR" -type f -name '*.dump' -mtime "+$RETENTION_DAYS" -delete
echo "Backup e restauração de teste concluídos."
