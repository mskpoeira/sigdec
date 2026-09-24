# SIGDEC v1.16 — ZIP imutável, assinatura interna e pendências SIDEC

## Objetivo

Tornar o ciclo de interoperabilidade SIDEC auditável também no nível do artefato
binário emitido, além de automatizar pendências e documentos obrigatórios.

A v1.16 acrescenta:

- ZIP emitido imutável;
- persistência binária do ZIP selado;
- SHA-256 do ZIP;
- assinatura interna HMAC-SHA256 do manifesto;
- verificação de hash e assinatura em todo download selado;
- requisitos documentais por padrão, COBRADE e tipo de ocorrência;
- seleção automática dos documentos mínimos exigidos;
- bloqueio da geração se documentos obrigatórios não forem selecionados;
- central de pendências SIDEC no Centro de Gestão;
- compatibilidade de selagem para revisões legadas.

## Ciclo do ZIP

Enquanto o pacote estiver em `READY`, o download ZIP é uma **prévia dinâmica**.

Ao executar:

`READY → EXPORTED`

o SIGDEC:

1. reconstrói o manifesto lógico;
2. confirma o SHA-256 do manifesto;
3. calcula a assinatura interna HMAC-SHA256;
4. gera o ZIP final;
5. calcula SHA-256 dos bytes do ZIP;
6. grava o binário em `sidec_export_artifacts`;
7. somente depois altera a revisão para `EXPORTED`.

Depois da selagem, downloads posteriores retornam exatamente o mesmo binário
armazenado.

## Imutabilidade no banco

Migration:

- `0024_sidec_sealed_artifacts_document_requirements.sql`

Tabela:

- `sidec_export_artifacts`

Existe trigger:

- `sidec_export_artifacts_immutable`

que rejeita `UPDATE` ou `DELETE` do artefato selado.

A chave primária é o próprio `export_id`, portanto existe no máximo um ZIP final
por revisão.

## Integridade do ZIP

Antes de devolver um ZIP selado, a API:

- recalcula SHA-256 do binário armazenado;
- compara com `content_hash`;
- verifica a assinatura HMAC do `manifest_hash`.

Erros:

- `SEALED_ZIP_INTEGRITY_ERROR`;
- `MANIFEST_SIGNATURE_INVALID`.

Headers informativos no download selado:

- `X-SIGDEC-Artifact-Mode: sealed`;
- `X-SIGDEC-Content-SHA256`;
- `X-SIGDEC-Manifest-SHA256`;
- `X-SIGDEC-Manifest-Signature`.

Na prévia:

- `X-SIGDEC-Artifact-Mode: preview`.

## Assinatura interna

Algoritmo:

- HMAC-SHA256.

Domínio criptográfico:

- `SIGDEC/SIDEC/MANIFEST/HMAC-SHA256/v1`.

Segredo preferencial:

- `SIDEC_MANIFEST_SIGNING_SECRET`.

Fallback de compatibilidade:

- `JWT_SECRET`.

Em produção, recomenda-se manter uma chave dedicada, forte, estável e diferente
do segredo de sessão.

A assinatura HMAC:

- comprova integridade/autenticidade interna perante a chave do SIGDEC;
- não equivale a certificado digital ICP-Brasil;
- não deve ser apresentada como assinatura qualificada.

A rotação da chave de assinatura invalida a verificação HMAC de artefatos históricos
assinados com a chave anterior. Por isso a chave dedicada deve ser preservada e
versionada por procedimento de gestão de segredos.

## Revisões legadas

Pacotes antigos sem `manifest_hash` podem ser exportados na v1.16.

Na primeira selagem o SIGDEC:

1. reconstrói o manifesto;
2. calcula o hash;
3. grava `manifest_hash` se ainda estiver nulo;
4. assina;
5. gera e persiste o ZIP final.

## Documentos obrigatórios

Tabela:

- `sidec_document_requirements`.

Escopos permitidos:

- `DEFAULT`;
- `COBRADE`;
- `INCIDENT_TYPE`.

Tipos documentais:

- `REPORT`;
- `OPINION`;
- `INTERDICTION`;
- `DECLARATION`;
- `FORM`;
- `OTHER`.

Cada regra possui:

- rótulo;
- quantidade mínima;
- obrigatório/recomendado;
- ativo/inativo.

Quando regras diferentes exigem o mesmo tipo documental, prevalece o maior
`min_count`.

Exemplo:

- padrão municipal: REPORT >= 1;
- COBRADE específico: REPORT >= 2.

Resultado efetivo:

- REPORT >= 2.

## Checklist documental

A prontidão da ocorrência considera:

1. campos gerais;
2. requisitos adicionais por COBRADE;
3. documentos oficiais emitidos exigidos pelo perfil.

A API de prontidão retorna:

- `documentRequirements`;
- `requiredDocumentIds`;
- `availableDocuments`.

A interface pré-seleciona os documentos emitidos mais recentes necessários para
cumprir o mínimo.

Na geração, o SIGDEC valida novamente a seleção.

Erro quando os documentos existem, mas não foram incluídos:

- `DOCUMENT_REQUIREMENTS_NOT_MET`.

## Administração de regras documentais

Listar:

`GET /api/v1/sidec/document-requirements`

Filtrar:

`GET /api/v1/sidec/document-requirements?scopeType=COBRADE&scopeValue=<codigo>`

Substituir regras de um escopo:

`PUT /api/v1/sidec/document-requirements`

Exemplo:

```json
{
  "scopeType": "COBRADE",
  "scopeValue": "1.2.3.4.5",
  "items": [
    {
      "documentType": "REPORT",
      "label": "Relatório técnico",
      "minCount": 2,
      "required": true,
      "enabled": true
    }
  ]
}
```

Alterações são auditadas.

## Central de pendências SIDEC

Endpoint:

`GET /api/v1/sidec/pending`

Situações calculadas:

- `NOT_READY` — ocorrência incompleta;
- `READY_TO_PACKAGE` — pronta para gerar pacote;
- `PACKAGE_READY` — revisão criada e pronta para exportar;
- `AWAITING_PROTOCOL` — ZIP já selado/exportado, aguardando protocolo externo;
- `AWAITING_RETURN` — protocolado, aguardando retorno;
- `REJECTED` — devolvido/rejeitado.

Para ocorrências ainda sem pacote, a fila executa o mesmo checklist de:

- campos;
- COBRADE;
- documentos emitidos.

O Centro de Gestão exibe:

- protocolo;
- prioridade;
- COBRADE;
- situação operacional;
- itens faltantes;
- protocolo externo;
- estado de selagem do ZIP;
- link direto para tratamento da ocorrência.

## Segurança

- artefato selado é imutável também no PostgreSQL;
- hash binário é validado antes do download;
- assinatura HMAC é validada antes do download;
- PDFs continuam originados do módulo oficial;
- documentos obrigatórios precisam estar emitidos;
- configuração de regras exige permissão própria;
- alterações são registradas em auditoria.

## Testes

A v1.16 adiciona cobertura para:

- assinatura/verificação HMAC;
- SHA-256 binário;
- merge de requisitos documentais;
- quantidade mínima;
- seleção automática dos documentos recentes;
- migration `0024`;
- existência do trigger de imutabilidade;
- constraints dos escopos e tipos documentais.

## Próxima evolução sugerida

- versionamento explícito de chaves HMAC para suportar rotação sem perder
  verificabilidade histórica;
- assinatura assimétrica do manifesto para validação externa;
- retenção/arquivamento de artefatos em object storage WORM;
- alertas automáticos de pendências SIDEC por prazo;
- integração oficial via API caso o Estado disponibilize contrato autorizado.
