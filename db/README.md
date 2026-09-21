# Banco de dados SIGDEC

O SIGDEC utiliza PostgreSQL com PostGIS.

## Matrícula

A matrícula é armazenada normalizada, sem pontuação. Exemplo: `915.789` → `915789`. A interface poderá reaplicar máscara apenas para exibição.

## Primeiro usuário Master

Dados reais do Master não são versionados no Git. O instalador deverá receber em ambiente seguro:

- `SIGDEC_MASTER_MATRICULA`
- `SIGDEC_MASTER_NAME`
- `SIGDEC_MASTER_EMAIL` (opcional)
- `SIGDEC_MASTER_PASSWORD`

Após o bootstrap, essas variáveis devem ser removidas ou desabilitadas. Senhas devem usar Argon2id e MFA será obrigatório para perfis estratégicos.
