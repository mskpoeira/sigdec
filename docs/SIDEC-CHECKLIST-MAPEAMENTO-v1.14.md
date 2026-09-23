# SIGDEC v1.14 — Checklist, mapeamento, documentos e comparação SIDEC

## Objetivo

Tornar a interoperabilidade SIDEC mais segura antes do envio, impedindo a geração
de pacotes incompletos, permitindo adaptar os nomes dos campos ao fluxo externo,
selecionar documentos oficiais e comparar revisões.

## Entregue

- checklist bloqueante de completude por ocorrência;
- validação de campos obrigatórios configuráveis;
- regra mínima de localização;
- mapeamento declarativo SIGDEC → SIDEC;
- lista fechada de caminhos de origem permitidos;
- campos de destino configuráveis;
- CSV gerado a partir do mapeamento configurado;
- `mappedFields` incluído no JSON;
- documentos técnicos emitidos selecionáveis;
- manifesto imutável dos documentos por revisão;
- schema do pacote atualizado para 1.1;
- snapshot do checklist armazenado em cada revisão;
- comparação entre revisões;
- diferenças por caminho de campo;
- interface integrada na tela Pacotes SIDEC;
- testes unitários e de integração atualizados.

## Checklist de completude

Endpoint:

`GET /api/v1/incidents/:id/sidec-readiness`

O checklist avalia todos os mapeamentos marcados como `required=true`.

Além disso, a localização é obrigatória e pode ser satisfeita por:

- endereço + bairro; ou
- latitude + longitude.

Se houver requisito obrigatório pendente:

`POST /api/v1/incidents/:id/sidec-exports`

retorna:

`409 NOT_READY`

e nenhuma revisão é criada.

### Campos padrão obrigatórios

- protocolo SIGDEC;
- código COBRADE;
- resumo;
- situação;
- prioridade;
- localização por endereço/bairro ou coordenadas.

Os requisitos podem ser ajustados pelo mapeamento municipal, respeitando a lista
de caminhos de origem permitidos pelo SIGDEC.

## Mapeamento configurável

Endpoints:

- `GET /api/v1/sidec/mappings`
- `PUT /api/v1/sidec/mappings`

Cada mapeamento possui:

- `sourcePath`;
- `targetField`;
- `required`;
- `enabled`;
- `sortOrder`.

Exemplo:

```json
{
  "sourcePath": "incident.protocol",
  "targetField": "ocorrencia.protocolo_sigdec",
  "required": true,
  "enabled": true,
  "sortOrder": 10
}
```

Não são permitidos scripts, expressões arbitrárias ou código executável.

### Caminhos de origem disponíveis

A v1.14 permite mapear somente campos operacionais previamente autorizados, como:

- `incident.protocol`;
- `incident.cobradeCode`;
- `incident.summary`;
- `incident.status`;
- `incident.priority`;
- `incident.description`;
- `incident.addressLine`;
- `incident.neighborhood`;
- `incident.referencePoint`;
- `incident.latitude`;
- `incident.longitude`;
- tipo, grupo, risco à vida, origem e datas da ocorrência.

## CSV mapeado

Quando `mappedFields` estiver presente no pacote schema 1.1, o CSV utiliza os
nomes dos campos de destino configurados pela organização.

Isso permite adaptar a estrutura de exportação sem alterar o código da API.

## Documentos oficiais no pacote

A tela de interoperabilidade lista apenas documentos:

- vinculados à mesma ocorrência;
- com status `ISSUED`.

A geração aceita:

```json
{
  "documentIds": ["uuid-do-documento"]
}
```

O SIGDEC grava no manifesto:

- ID;
- número;
- título;
- tipo;
- revisão;
- SHA-256 do documento.

A tabela de manifesto usa `ON DELETE RESTRICT`, preservando a referência documental
de pacotes já gerados.

Os arquivos PDF continuam sendo servidos pelo módulo oficial de documentos; o
pacote não duplica o armazenamento do PDF.

## Comparação entre revisões

Endpoint:

`GET /api/v1/sidec-exports/:id/compare`

Sem parâmetro, compara com a revisão imediatamente anterior.

Opcionalmente:

`GET /api/v1/sidec-exports/:id/compare?against=<exportId>`

A comparação somente é aceita entre revisões da mesma ocorrência.

O retorno informa:

- revisão atual;
- revisão de comparação;
- quantidade de diferenças;
- caminho;
- valor anterior;
- valor novo.

## Pacote schema 1.1

O pacote inclui:

- `schemaVersion`;
- `generatedAt`;
- município;
- ocorrência;
- ações;
- vistorias;
- solicitações;
- assistência humanitária;
- timeline minimizada;
- `documents`;
- `mappedFields`.

Cada revisão continua recebendo hash SHA-256 canônico.

## Banco de dados

Migration:

- `0022_sidec_readiness_mapping_documents.sql`

Estruturas:

- `sidec_field_mappings`;
- `sidec_export_documents`;
- coluna `sidec_exports.readiness_snapshot`.

## Governança

O mapeamento global funciona como padrão. A organização pode criar overrides
municipais por campo.

Desativar um campo cria um override desabilitado; a interface não simplesmente
remove um padrão global, evitando que ele reapareça de forma inesperada.

## Próxima evolução sugerida

- checklist específico por tipo COBRADE;
- geração de um ZIP contendo JSON/CSV e PDFs emitidos selecionados;
- assinatura/hash do manifesto completo do pacote;
- filtros de comparação por categoria;
- importação estruturada de retorno estadual quando houver formato oficial disponível.
