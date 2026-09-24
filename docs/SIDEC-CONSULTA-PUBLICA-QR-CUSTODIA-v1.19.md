# SIGDEC v1.19 — Consulta pública, QR Code e cadeia de custódia SIDEC

## Objetivo

Tornar a prova de integridade criada na v1.18 diretamente consultável por terceiros,
sem login, mantendo o ZIP selado imutável e sem expor dados operacionais da ocorrência.

A v1.19 acrescenta:

- consulta pública pelo SHA-256 do ZIP;
- URL pública por artefato;
- comprovante `sigdec-sidec-integrity-proof/1.1`;
- carimbo de tempo interno assinado por Ed25519;
- QR Code de verificação pública;
- PDF de cadeia de custódia;
- registro das consultas públicas como verificações externas;
- compatibilidade integral com comprovantes v1.18 (`proof/1.0`).

## Identificador público

O identificador público é o próprio:

`artifactHash = SHA-256 do ZIP selado`

URL:

`/integridade/<artifactHash>`

Não é necessário armazenar token adicional.

A consulta pública exibe somente:

- protocolo;
- revisão;
- versão do schema;
- SHA-256 do ZIP;
- SHA-256 do manifesto;
- keyId/fingerprint Ed25519;
- data da atestação;
- carimbo interno;
- validade criptográfica.

Conteúdo operacional, documentos e dados pessoais não são expostos.

## Comprovante 1.1

Novos comprovantes usam:

`sigdec-sidec-integrity-proof/1.1`

Além do conteúdo da versão 1.0, incluem:

- `publicVerificationUrl`;
- bloco `timestamp`.

O verificador continua aceitando `proof/1.0`.

### Validade

Para `proof/1.0`:

- validade principal = Ed25519 do artefato.

Para `proof/1.1`:

- Ed25519 do artefato deve ser válido;
- Ed25519 do timestamp deve ser válido.

HMAC continua sendo camada interna adicional quando a chave histórica estiver disponível.

## Carimbo de tempo interno

Migration:

- `0027_sidec_public_integrity_timestamp_custody.sql`

Tabela:

- `sidec_integrity_timestamps`

O carimbo vincula:

- manifest hash;
- artifact hash;
- assinatura Ed25519 da atestação;
- instante do carimbo.

Domínio criptográfico:

`SIGDEC/SIDEC/TIMESTAMP/ED25519/v1`

O statement canônico recebe SHA-256 e assinatura Ed25519.

### Importante

Esse carimbo:

- é interno ao SIGDEC;
- é auditável;
- detecta alteração dos dados assinados;
- **não equivale a TSA externa**;
- **não equivale a carimbo do tempo ICP-Brasil**.

## Consulta pública

Endpoint:

`GET /api/v1/public/sidec-integrity/:artifactHash`

A rota:

1. localiza o artefato pelo SHA-256;
2. verifica a atestação Ed25519;
3. verifica o carimbo interno;
4. registra a consulta em `sidec_integrity_verifications`;
5. retorna somente metadados de integridade.

Página Web:

`/integridade/<artifactHash>`

## QR Code

A cadeia de custódia em PDF contém QR Code apontando para a URL pública do artefato.

O QR não contém dados sensíveis; contém apenas a URL baseada no SHA-256 do ZIP.

Dependência:

- `qrcode`.

## PDF de cadeia de custódia

Endpoint:

`GET /api/v1/sidec-exports/:id/custody-pdf`

Conteúdo:

- organização;
- protocolo e revisão;
- QR Code;
- URL de verificação pública;
- SHA-256 do ZIP;
- SHA-256 do manifesto;
- HMAC keyId;
- Ed25519 keyId;
- fingerprint da chave pública;
- datas de selagem e atestação;
- statement hash do timestamp;
- fingerprint do timestamp;
- eventos de timeline;
- eventos de auditoria;
- histórico de verificações;
- nota explícita sobre a natureza interna do timestamp.

## Verificador manual

A rota existente:

`/verificar-integridade`

passa a mostrar também:

- validade do timestamp para `proof/1.1`;
- “não aplicável” para comprovantes antigos `proof/1.0`.

## Compatibilidade histórica

Artefatos v1.16–v1.18 continuam imutáveis.

Quando um artefato histórico já possui atestação Ed25519 e recebe o primeiro pedido
de comprovante/cadeia de custódia na v1.19:

- o ZIP não é alterado;
- seus hashes permanecem iguais;
- o timestamp interno é criado em tabela separada;
- a nova URL pública passa a ser utilizável.

## Segurança

- nenhum segredo é colocado no QR Code;
- a página pública não expõe resumo, documentos ou dados pessoais;
- o SHA-256 do ZIP funciona como identificador público;
- o timestamp é assinado com domínio criptográfico separado;
- consultas públicas são registradas;
- PDF e QR são derivados do comprovante validado;
- o ZIP selado continua protegido por SHA-256 + HMAC + Ed25519.

## Próxima evolução sugerida

- armazenamento WORM/Object Lock dos ZIPs selados;
- carimbo de tempo externo confiável/TSA;
- certificado institucional ICP-Brasil quando houver política e infraestrutura adequadas;
- comprovante PDF público compacto;
- exportação do registro de integridade em formato interoperável;
- webhooks/notificações externas para eventos críticos de interoperabilidade.
