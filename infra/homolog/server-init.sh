#!/usr/bin/env bash
set -Eeuo pipefail

SIGDEC_DIR=/opt/sigdec
ENV_FILE="$SIGDEC_DIR/infra/homolog/.env"
MASTER_FILE=/root/SIGDEC_MASTER_INITIAL_PASSWORD.txt

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root."
  exit 1
fi

command -v openssl >/dev/null 2>&1
docker version >/dev/null
docker compose version >/dev/null

cd "$SIGDEC_DIR"

if [ ! -f "$ENV_FILE" ]; then
  umask 077

  POSTGRES_PASSWORD=$(openssl rand -hex 32)
  JWT_SECRET=$(openssl rand -hex 48)
  MINIO_PASSWORD=$(openssl rand -hex 32)
  MASTER_PASSWORD=$(openssl rand -hex 20)

  cat > "$ENV_FILE" <<EOF
SIGDEC_DOMAIN=sigdec.mskpoeira.com.br
POSTGRES_DB=sigdec
POSTGRES_USER=sigdec
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
SESSION_HOURS=8
MINIO_ROOT_USER=sigdec-storage
MINIO_ROOT_PASSWORD=$MINIO_PASSWORD
S3_REGION=us-east-1
S3_BUCKET=sigdec
SIGDEC_ORG_NAME='Prefeitura Municipal de Ubatuba'
SIGDEC_ORG_SLUG=ubatuba
SIGDEC_MASTER_MATRICULA=915.789
SIGDEC_MASTER_NAME='Thiago Alves Cardozo'
SIGDEC_MASTER_EMAIL=
SIGDEC_MASTER_PHONE=
SIGDEC_MASTER_JOB_TITLE='Ouvidor Geral / Administrador Master'
SIGDEC_MASTER_DEPARTMENT='Ouvidoria Geral'
SIGDEC_MASTER_PASSWORD=$MASTER_PASSWORD
EOF

  printf '%s\n' "$MASTER_PASSWORD" > "$MASTER_FILE"
  chmod 600 "$MASTER_FILE"
fi

chmod 600 "$ENV_FILE"
chmod +x "$SIGDEC_DIR/infra/homolog/deploy.sh"
"$SIGDEC_DIR/infra/homolog/deploy.sh"

echo "SIGDEC_SERVER_INIT=OK"
echo "Senha inicial Master armazenada somente em $MASTER_FILE com permissão 600."
