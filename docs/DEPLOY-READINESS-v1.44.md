# SIGDEC v1.44 — Verificação de publicação

`/health` continua indicando se o processo HTTP responde. `/api/v1/ready` consulta o
PostgreSQL antes de informar `ready`; em falha de banco retorna HTTP 503 e não
expõe detalhes de conexão ao cliente.

O deploy automático de homologação agora implanta exatamente o commit aprovado no CI.
Se `main` mudar antes do deploy, o workflow antigo falha e a execução do novo
commit assume a publicação. A checagem final exige simultaneamente HTTP 200,
`status=ready` e a versão correspondente ao `package.json` do commit aprovado.

Essa verificação prova disponibilidade básica da API e do banco. Ela não
substitui testes autenticados dos módulos, dos serviços externos ou da
experiência real dos operadores.
