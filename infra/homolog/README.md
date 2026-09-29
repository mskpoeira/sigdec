# Homologação no servidor

O ambiente de homologação do SIGDEC é autocontido.

## Isolamento

O SIGDEC possui:
- rede Docker própria `sigdec-homolog`;
- PostgreSQL/PostGIS próprio;
- Redis próprio;
- MinIO próprio;
- API própria;
- Web própria;
- Caddy próprio;
- volumes próprios.

Nenhum contêiner, rede, volume, proxy ou workflow de outro projeto é necessário.

## Primeira instalação

1. Clonar este repositório em diretório exclusivo.
2. Criar `infra/homolog/.env` a partir de `.env.example`.
3. Preencher os segredos.
4. Executar `infra/homolog/deploy.sh`.

Por padrão, o proxy exclusivo do SIGDEC escuta apenas em interfaces locais configuráveis por `SIGDEC_HTTP_BIND` e `SIGDEC_HTTPS_BIND`. A exposição pública deve usar endpoint dedicado ao SIGDEC.

## Atualizações

Atualize apenas este repositório e execute novamente `infra/homolog/deploy.sh`.
