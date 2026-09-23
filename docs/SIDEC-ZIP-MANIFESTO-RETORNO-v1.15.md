# SIGDEC v1.15 — ZIP documental, manifesto, checklist COBRADE e retorno estruturado

## Objetivo

Evoluir a interoperabilidade controlada com o SIDEC/SP sem simular integração automática
ou formatos oficiais não documentados.

A v1.15 acrescenta:

- pacote ZIP real;
- manifesto lógico com SHA-256 persistido;
- PDFs oficiais emitidos no pacote;
- requisitos adicionais configuráveis por COBRADE;
- comparação filtrável por categoria;
- envelope SIGDEC para importação estruturada de retorno;
- idempotência e auditoria do retorno.

## Manifesto lógico

Cada revisão recebe um manifesto:

`sigdec-sidec-manifest/1.0`

O manifesto contém:

- versão do schema do pacote;
- número da revisão;
- SHA-256 do snapshot;
- documentos selecionados;
- número/título/tipo/revisão/hash de cada documento.

O hash do manifesto é calculado sobre JSON canônico e persistido em:

`sidec_exports.manifest_hash`

### Por que o hash não é do ZIP

O ZIP é um contêiner de transporte. Metadados internos de compactação ou PDF podem
alterar os bytes do arquivo sem modificar o conteúdo lógico da revisão.

Por isso, o hash persistido protege o manifesto estável do pacote, não o binário ZIP.

## ZIP completo

Endpoint:

`GET /api/v1/sidec-exports/:id/download?format=zip`

Conteúdo:

- `pacote.json`;
- `resumo.csv`;
- `manifesto.json`;
- `documentos/*.pdf`.

Antes de gerar o ZIP, o SIGDEC:

1. reconstrói o manifesto a partir do banco;
2. recalcula o SHA-256;
3. compara com `manifest_hash`;
4. valida o hash oficial dos documentos;
5. só então gera os PDFs e compacta.

Em divergência, o download é bloqueado.

Erros de integridade:

- `MANIFEST_INTEGRITY_ERROR`;
- `DOCUMENT_INTEGRITY_ERROR`;
- `DOCUMENT_NOT_AVAILABLE`.

Os PDFs são gerados pelo mesmo mecanismo do módulo Documentos Oficiais.

## Requisitos adicionais por COBRADE

A v1.15 não pré-carrega exigências estaduais presumidas.

O município pode configurar requisitos adicionais por código COBRADE usando apenas
caminhos de origem previamente autorizados pelo SIGDEC.

Endpoints:

- `GET /api/v1/sidec/cobrade-requirements?cobradeCode=...`
- `PUT /api/v1/sidec/cobrade-requirements`

Exemplo:

```json
{
  "cobradeCode": "1.2.3.4.5",
  "items": [
    {
      "sourcePath": "incident.description",
      "label": "Descrição técnica detalhada",
      "required": true,
      "enabled": true,
      "sortOrder": 10
    }
  ]
}
```

As regras específicas são combinadas com o checklist geral.

Se qualquer requisito obrigatório falhar, a geração continua bloqueada com:

`409 NOT_READY`

## Comparação por categoria

Endpoint:

`GET /api/v1/sidec-exports/:id/compare?category=...`

Categorias:

- `all`;
- `incident`;
- `mappedFields`;
- `documents`;
- `actions`;
- `inspections`;
- `supportRequests`;
- `humanitarianDeliveries`;
- `timeline`;
- `municipality`;
- `other`.

A resposta informa quantidade filtrada e total de diferenças.

## Retorno estruturado

A v1.15 define um envelope do próprio SIGDEC:

`sigdec-sidec-return/1.0`

Este envelope **não é apresentado como formato oficial do SIDEC/SP**.

Endpoint:

`POST /api/v1/sidec-exports/:id/returns/import`

Exemplo:

```json
{
  "schemaVersion": "sigdec-sidec-return/1.0",
  "externalProtocol": "PROTOCOLO-EXTERNO",
  "outcome": "ACKNOWLEDGED",
  "receivedAt": "2026-09-23T22:00:00-03:00",
  "sourceName": "SIDEC/SP",
  "notes": "Recebimento confirmado."
}
```

Regras:

- pacote precisa estar `SUBMITTED`;
- protocolo externo precisa coincidir;
- outcome permitido: `ACKNOWLEDGED` ou `REJECTED`;
- payload é normalizado e recebe SHA-256;
- a mesma resposta não é importada duas vezes;
- status do pacote é atualizado;
- timeline e auditoria são registradas.

Listagem:

`GET /api/v1/sidec-exports/:id/returns`

## Banco de dados

Migration:

- `0023_sidec_manifest_cobrade_returns.sql`

Estruturas:

- coluna `sidec_exports.manifest_hash`;
- tabela `sidec_cobrade_requirements`;
- tabela `sidec_return_records`.

## Segurança e governança

- nenhum script arbitrário é aceito nas regras COBRADE;
- os caminhos de origem seguem a lista fechada de campos do SIGDEC;
- documentos entram no pacote somente quando emitidos;
- o manifesto documental usa hashes já controlados pelo módulo oficial;
- retorno estruturado é idempotente;
- a integração continua manual/controlada até existir API ou contrato oficial autorizado.

## Próxima evolução sugerida

- guardar uma cópia binária imutável do ZIP emitido;
- assinatura digital do manifesto;
- validação automática de anexos exigidos por tipo de desastre;
- painel de pendências de interoperabilidade por ocorrência;
- adaptador oficial SIDEC caso seja disponibilizada API autorizada.
