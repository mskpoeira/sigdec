#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root: sudo bash infra/homolog/bootstrap-host.sh"
  exit 1
fi

command -v git >/dev/null 2>&1 || {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates curl openssl
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker Engine..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi

docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 nao encontrado."
  exit 1
}

install -d -m 0750 /opt/sigdec

if [ ! -d /opt/sigdec/.git ]; then
  git clone https://github.com/mskpoeira/sigdec.git /opt/sigdec
else
  git -C /opt/sigdec fetch --prune origin
  git -C /opt/sigdec checkout main
  git -C /opt/sigdec reset --hard origin/main
fi

cd /opt/sigdec/infra/homolog

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo
  echo "Arquivo /opt/sigdec/infra/homolog/.env criado."
  echo "Preencha os segredos e dados institucionais antes do primeiro deploy."
  exit 2
fi

chmod 600 .env
chmod +x deploy.sh
./deploy.sh
