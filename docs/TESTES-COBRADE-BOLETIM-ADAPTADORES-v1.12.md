# SIGDEC v1.12 — Testes de integração, catálogo COBRADE, boletim público e adaptadores

## Entregue

- testes unitários executados no CI;
- PostgreSQL/PostGIS descartável no GitHub Actions;
- execução automática de todas as migrations no CI;
- testes de integração do schema após as migrations;
- catálogo COBRADE importável por CSV;
- rastreabilidade de fonte, versão, usuário e data de importação;
- validação opcional de códigos de modelos contra o catálogo importado;
- boletim público derivado somente de SITREP aprovado ou emitido;
- boletim nasce como DRAFT e segue revisão/aprovação/emissão próprias;
- snapshot do SITREP de origem preservado no boletim;
- adaptador SIGDEC_GENERIC_V1;
- adaptador GEOPIXEL_BRIDGE_V1;
- exigência de conector GEOPIXEL ativo para o bridge;
- validação opcional de referência externa da estação;
- auditoria do adaptador usado na ingestão.

## Testes automatizados

O CI executa, nesta ordem:

1. instalação das dependências;
2. typecheck;
3. testes unitários;
4. subida de PostGIS 16;
5. aplicação integral das migrations;
6. testes de integração do schema;
7. build completo.

Os testes unitários cobrem:

- normalização de payload genérico;
- normalização do bridge GeoPixel;
- rejeição de adaptadores não suportados;
- importação de CSV COBRADE;
- detecção de códigos duplicados;
- geração de boletim público sem campos pessoais.

Os testes de integração cobrem:

- aplicação das migrations recentes;
- colunas documentais de origem/snapshot;
- unicidade de código COBRADE por organização;
- constraints dos conectores.

## Catálogo COBRADE

Endpoint:

`POST /api/v1/cobrade/catalog/import`

Corpo:

```json
{
  "csv": "codigo;nome;grupo;subgrupo;tipo;subtipo\n...",
  "sourceName": "fonte oficial",
  "sourceVersion": "2026-09"
}
```

Cabeçalhos mínimos aceitos:

- codigo / codigocobrade / cobrade / code;
- nome / descricao / denominacao / name.

A importação faz upsert por organização + código e registra auditoria.

## Boletim público

Endpoint:

`POST /api/v1/technical-documents/:sitrepId/public-bulletin-draft`

Regras:

- a origem precisa ser um documento `source_type=SITREP`;
- o SITREP precisa estar `APPROVED` ou `ISSUED`;
- o novo boletim é criado como `DRAFT`;
- recebe numeração documental própria;
- possui SHA-256 próprio;
- preserva referência e snapshot do SITREP de origem;
- exige revisão/aprovação antes de qualquer emissão.

## Adaptadores de monitoramento

### SIGDEC_GENERIC_V1

Contrato:

```json
{
  "measuredAt": "2026-09-23T18:00:00-03:00",
  "metric": "chuva_1h",
  "value": 35.2,
  "unit": "mm"
}
```

### GEOPIXEL_BRIDGE_V1

Contrato do bridge SIGDEC:

```json
{
  "timestamp": "2026-09-23T18:00:00-03:00",
  "metric": "chuva_1h",
  "reading": 35.2,
  "unit": "mm",
  "externalStationId": "UBT-01"
}
```

Header:

`X-SIGDEC-ADAPTER: GEOPIXEL_BRIDGE_V1`

Além da chave Bearer de ingestão, o SIGDEC exige um conector ativo com
`provider_code=GEOPIXEL` para a estação. Caso o conector possua referência
externa, ela precisa coincidir com `externalStationId`.

O bridge não pressupõe nem inventa uma API pública da GeoPixel. Ele define o
contrato seguro que um integrador autorizado pode usar para encaminhar leituras
ao SIGDEC.

## Banco de dados

- `0019_cobrade_catalog.sql`

## Próxima evolução sugerida

- suíte de testes HTTP com Fastify inject;
- catálogo COBRADE oficial carregável por arquivo/URL validado;
- página pública somente para documentos explicitamente emitidos como boletim;
- adaptadores adicionais após confirmação dos contratos de dados;
- alertas internos de falha/atraso de conectores.
