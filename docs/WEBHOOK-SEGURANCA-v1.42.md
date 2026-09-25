# SIGDEC v1.42 — entrega segura de webhooks

## Correção

A validação anterior resolvia o DNS do endpoint e depois usava `fetch`, que
resolvia o nome novamente ao abrir a conexão. Um destino com DNS alterável
poderia mudar para uma rede local entre as duas etapas.

A entrega agora verifica todos os endereços retornados pelo DNS, rejeita redes
privadas, locais, reservadas e IPv4 encapsulado em IPv6, e fixa um endereço
validado na conexão HTTPS. O nome original continua sendo usado para TLS/SNI e
verificação do certificado. Não há redirecionamento automático. URLs com
credenciais embutidas também são rejeitadas. O tempo limite continua em dez
segundos e o trecho salvo da resposta tem no máximo mil caracteres.

## Verificações

- typecheck da API e do Web;
- testes unitários de endereços bloqueados e públicos;
- pipeline CI com testes, migrações e build;
- deploy de homologação e confirmação de `/health` na versão 1.42.0.

Webhooks antigos com destinos não públicos deixarão de ser entregues e seguirão
o mecanismo existente de tentativas e falha, com erro registrado no histórico.
