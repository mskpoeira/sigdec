# SIGDEC v1.9 — Integração monitoramento → alerta e ingestão externa

## Entregue

- vínculo único entre evento de monitoramento e alerta;
- criação assistida de rascunho de alerta diretamente a partir de um evento;
- alerta originado do monitoramento permanece em DRAFT até publicação humana;
- Centro de Gestão exibe origem do alerta, estação e eventos de monitoramento abertos;
- chaves de ingestão externas por estação;
- token em claro exibido somente no momento da criação;
- persistência exclusiva do hash SHA-256 da chave;
- endpoint externo autenticado por Bearer token;
- leitura externa passa pelo mesmo motor de limiares da leitura manual;
- atualização de last_used_at da chave;
- auditoria de criação da chave, ingestão externa e geração de rascunho de alerta;
- segregação por organização e estação.

## Endpoint de ingestão

POST /api/v1/integrations/monitoring/readings

Headers:

- Authorization: Bearer <token-da-estacao>
- Content-Type: application/json

Corpo:

```json
{
  "measuredAt": "2026-09-23T16:00:00-03:00",
  "metric": "chuva_1h",
  "value": 42.5,
  "unit": "mm"
}
```

A estação é determinada exclusivamente pela chave utilizada. O cliente externo não
pode escolher outra estação ou organização no corpo da requisição.

## Fluxo operacional

1. Sensor/fonte envia leitura.
2. SIGDEC autentica a chave e identifica a estação.
3. A leitura é persistida.
4. O motor avalia os limiares ativos.
5. Se houver ultrapassagem, é criado um evento operacional.
6. O operador reconhece o evento e, se necessário, cria um rascunho de alerta.
7. O Centro de Gestão revisa o conteúdo.
8. A publicação do alerta exige ação humana explícita.

## Banco de dados

A migração `0015_monitoring_alert_ingest.sql`:

- adiciona `alerts.monitoring_event_id`;
- impede mais de um alerta por evento;
- cria `monitoring_ingest_keys`;
- mantém somente o hash das credenciais externas.

## Próxima evolução sugerida

Implementar revogação/rotação de chaves, protocolos operacionais versionados,
webhooks de fornecedores específicos e integração de eventos com mapa/SITREP.
