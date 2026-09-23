# SIGDEC v1.13 — Interoperabilidade controlada com o SIDEC/SP

## Objetivo

Preparar dados municipais de uma ocorrência em um pacote versionado, íntegro e
rastreável para lançamento controlado no SIDEC/SP, sem simular integração automática
onde não há contrato/API oficial confirmada.

## Entregue

- geração de pacote SIDEC por ocorrência;
- revisão incremental por ocorrência;
- snapshot imutável dos dados incluídos;
- hash SHA-256 canônico do snapshot;
- download em JSON;
- download CSV-resumo;
- histórico completo de revisões;
- fila gerencial no Centro de Gestão;
- acesso direto pela ocorrência;
- registro de protocolo externo;
- registro de retorno/observação do órgão estadual;
- timeline da ocorrência atualizada a cada geração/transição;
- auditoria de geração e mudanças de estado;
- minimização de dados pessoais no pacote.

## Ciclo de vida

```
READY
  ├─> EXPORTED
  │     └─> SUBMITTED
  │            ├─> ACKNOWLEDGED
  │            └─> REJECTED
  └─> CANCELLED
```

Uma rejeição não reabre o mesmo snapshot. Quando houver correção na ocorrência,
o operador deve gerar uma nova revisão, preservando o histórico da versão rejeitada.

## Conteúdo do pacote

O snapshot inclui:

- identificação e protocolo SIGDEC;
- status e prioridade;
- tipo de ocorrência;
- código COBRADE associado ao tipo, quando disponível;
- resumo e descrição operacional;
- endereço, bairro, referência e coordenadas;
- ações municipais registradas;
- vistorias vinculadas;
- solicitações operacionais;
- entregas humanitárias sem identificação nominal do destinatário;
- linha do tempo reduzida a data/hora e tipo de evento.

## Minimização LGPD

O pacote de interoperabilidade não inclui:

- nome do solicitante;
- telefone do solicitante;
- nome individual do destinatário de entrega humanitária;
- conteúdo livre da timeline/metadata quando desnecessário ao intercâmbio.

O dado completo permanece no SIGDEC, respeitando o princípio de necessidade.

## Integridade

O SIGDEC serializa o snapshot de forma canônica e calcula SHA-256.
A ordem das chaves JSON não altera o hash.

Exemplo de identificação de arquivo:

- `SIDEC-DC-2026-000001-R1.json`
- `SIDEC-DC-2026-000001-R1.csv`

## API

### Listar revisões da ocorrência

`GET /api/v1/incidents/:id/sidec-exports`

### Gerar nova revisão

`POST /api/v1/incidents/:id/sidec-exports`

### Fila gerencial

`GET /api/v1/sidec-exports`

### Download

`GET /api/v1/sidec-exports/:id/download?format=json`

`GET /api/v1/sidec-exports/:id/download?format=csv`

### Atualizar situação

`PATCH /api/v1/sidec-exports/:id/status`

Exemplo:

```json
{
  "status": "SUBMITTED",
  "externalProtocol": "protocolo gerado no SIDEC",
  "externalNotes": "encaminhado ao Estado"
}
```

## Banco de dados

Migration:

- `0021_sidec_interoperability.sql`

Tabela:

- `sidec_exports`

## Garantias de concorrência

A criação de nova revisão bloqueia a linha da ocorrência durante o cálculo do próximo
número, evitando que dois operadores criem a mesma revisão simultaneamente.

## Limite de integração

A v1.13 não executa scraping, automação de navegador ou chamadas a endpoints privados
do SIDEC. A integração automática futura só deve ser ativada com contrato técnico/API
oficial e autorização apropriada.

## Próxima evolução sugerida

- mapeamento configurável de campos SIGDEC → SIDEC;
- checklist de completude antes de liberar um pacote;
- comparação visual entre revisões;
- anexos selecionáveis no pacote;
- importação do retorno/protocolo por arquivo estruturado quando disponível.
