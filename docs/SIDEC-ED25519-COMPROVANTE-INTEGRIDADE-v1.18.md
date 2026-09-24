# SIGDEC v1.18 — Ed25519, comprovante público e evidências de integridade

## Objetivo

Permitir que a integridade de um artefato SIDEC seja verificada por terceiros sem
acesso a qualquer segredo interno do SIGDEC.

A v1.18 mantém o HMAC existente para controle interno e acrescenta:

- atestação assimétrica Ed25519;
- chave pública preservada junto da atestação;
- fingerprint SHA-256 da chave pública;
- comprovante JSON autocontido;
- verificador público de comprovantes;
- registro de verificações internas e externas;
- dossiê JSON de evidências administrativas;
- validação Ed25519 em todo download de ZIP selado;
- compatibilidade com artefatos históricos v1.16/v1.17.

## Por que a atestação é separada do ZIP

O ZIP selado é imutável.

Inserir uma assinatura assimétrica dentro do ZIP após calcular seu SHA-256 alteraria
os bytes e, portanto, mudaria o próprio hash que a assinatura pretende autenticar.

A v1.18 utiliza uma atestação externa e separada:

- `manifestHash`;
- `artifactHash`.

O payload assinado é canônico e possui domínio:

`SIGDEC/SIDEC/INTEGRITY/ED25519/v1`

A assinatura Ed25519 vincula criptograficamente o manifesto lógico ao binário ZIP.

## Tabela de atestações

Migration:

- `0026_sidec_ed25519_integrity_proofs.sql`

Tabela:

- `sidec_artifact_attestations`

Campos principais:

- `export_id`;
- algoritmo;
- `key_id`;
- assinatura base64;
- chave pública PEM;
- fingerprint SHA-256 da chave pública;
- usuário/data da atestação.

A atestação fica fora de `sidec_export_artifacts`.

Com isso, ZIPs históricos já imutáveis podem receber uma atestação Ed25519 sem
qualquer `UPDATE` do artefato.

## Seed privada Ed25519

Variáveis:

```env
SIDEC_ED25519_PRIVATE_SEED_BASE64=
SIDEC_ED25519_KEY_ID=derived-v1
```

A seed dedicada deve:

- possuir exatamente 32 bytes;
- ser codificada em base64;
- permanecer fora do repositório;
- ser gerenciada como segredo de produção.

Se a seed não for configurada, o SIGDEC deriva uma seed determinística a partir
do segredo interno existente. Esse fallback existe para compatibilidade e
homologação.

Em produção, recomenda-se uma seed Ed25519 dedicada.

## Chave pública

A chave pública:

- não é segredo;
- é armazenada em PEM;
- acompanha o comprovante;
- recebe fingerprint SHA-256 sobre DER/SPKI.

A verificação independe da chave privada.

## Comprovante de integridade

Schema:

`sigdec-sidec-integrity-proof/1.0`

Endpoint autenticado para emissão:

`GET /api/v1/sidec-exports/:id/integrity-proof`

Download:

`GET /api/v1/sidec-exports/:id/integrity-proof?download=1`

Conteúdo:

- ID da revisão;
- protocolo;
- revisão;
- schema do pacote;
- data de selagem;
- nome/tamanho do ZIP;
- SHA-256 do ZIP;
- SHA-256 do manifesto;
- HMAC-SHA256 interno;
- keyId HMAC;
- assinatura Ed25519;
- keyId Ed25519;
- chave pública PEM;
- fingerprint;
- data da atestação.

Antes de emitir o comprovante, o SIGDEC:

1. recalcula SHA-256 do ZIP armazenado;
2. confirma o hash persistido;
3. cria a atestação Ed25519 se ainda não existir;
4. verifica a atestação;
5. somente então entrega o comprovante.

## Verificador público

Endpoint:

`POST /api/v1/sidec/verify-integrity-proof`

Esse endpoint não depende de sessão autenticada para executar a validação
criptográfica do comprovante.

O verificador:

- valida o schema;
- recalcula o fingerprint da chave pública;
- verifica Ed25519;
- tenta validar HMAC quando a chave histórica correspondente estiver disponível;
- verifica se ID, hashes, protocolo, revisão e schema correspondem a um artefato
  registrado no SIGDEC consultado;
- registra o resultado da verificação.

Resultado exemplo:

```json
{
  "valid": true,
  "asymmetricValid": true,
  "hmacValid": true,
  "registeredArtifact": true,
  "proofVersion": "sigdec-sidec-integrity-proof/1.0",
  "publicKeyFingerprint": "..."
}
```

A validade criptográfica principal é determinada pela Ed25519.

O HMAC continua sendo uma camada interna adicional.

## Página Web

Nova rota:

`/verificar-integridade`

Permite:

- carregar um arquivo JSON;
- colar o comprovante;
- executar a verificação;
- visualizar validade Ed25519;
- visualizar HMAC quando disponível;
- confirmar correspondência com um artefato registrado;
- consultar o fingerprint da chave pública.

## Download do ZIP selado

Na v1.18, todo download selado valida:

1. SHA-256 do ZIP;
2. HMAC-SHA256 do manifesto;
3. Ed25519 da atestação.

Se qualquer validação falhar, o ZIP não é entregue.

Headers adicionais:

- `X-SIGDEC-Ed25519-Key-Id`;
- `X-SIGDEC-Ed25519-Fingerprint`;
- `X-SIGDEC-Ed25519-Signature`.

Também permanecem:

- `X-SIGDEC-Content-SHA256`;
- `X-SIGDEC-Manifest-SHA256`;
- `X-SIGDEC-Manifest-Signature`;
- `X-SIGDEC-Signing-Key-Id`.

## Registro de verificações

Tabela:

- `sidec_integrity_verifications`

Registra:

- versão do comprovante;
- hashes;
- validade HMAC;
- validade assimétrica;
- validade geral;
- origem da verificação;
- IP;
- user-agent;
- data/hora.

Origens:

- `INTERNAL`;
- `EXTERNAL`;
- `API`.

Endpoint de consulta:

`GET /api/v1/sidec-exports/:id/integrity-verifications`

## Dossiê de evidências

Endpoint:

`GET /api/v1/sidec-exports/:id/integrity-evidence`

Download:

`GET /api/v1/sidec-exports/:id/integrity-evidence?download=1`

Schema:

`sigdec-sidec-integrity-evidence/1.0`

O dossiê agrega:

- comprovante criptográfico;
- retenção;
- retornos SIDEC;
- timeline da ocorrência relacionada à interoperabilidade;
- trilha de auditoria;
- histórico de verificações.

O dossiê é uma exportação administrativa de evidências. O artefato probatório
criptográfico principal continua sendo o comprovante assinado e os hashes do ZIP.

## Compatibilidade com versões anteriores

Artefatos v1.16/v1.17 permanecem imutáveis.

Quando um artefato histórico recebe o primeiro pedido de comprovante ou download
após a v1.18:

1. seu ZIP não é alterado;
2. seus hashes permanecem os mesmos;
3. uma atestação Ed25519 é criada em tabela separada;
4. a nova atestação passa a poder ser verificada independentemente.

## Segurança

- chave privada Ed25519 nunca é gravada no banco;
- comprovantes contêm apenas chave pública;
- a atestação não modifica o ZIP;
- fingerprint detecta substituição da chave pública;
- assinatura cobre os hashes do manifesto e do ZIP;
- verificador público não revela dados adicionais do sistema além do resultado
  da verificação do comprovante fornecido;
- correspondência com registro SIGDEC exige protocolo, revisão e schema corretos;
- verificações são auditáveis.

## Próxima evolução sugerida

- QR Code do comprovante nos documentos de remessa;
- página pública por token/hash para consulta de integridade sem upload manual;
- carimbo de tempo externo confiável;
- armazenamento WORM/object lock do ZIP;
- exportação de cadeia de custódia em PDF;
- assinatura institucional com certificado ICP-Brasil quando houver infraestrutura
  e política municipal apropriadas.
