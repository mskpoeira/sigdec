# SIGDEC v0.2 — Identidade e Controle de Acesso

## Login

O login institucional usa matrícula e senha. A matrícula é normalizada antes da autenticação, portanto pontuação visual não altera o identificador.

Exemplo: `915.789` e `915789` são normalizados para o mesmo identificador interno.

## Primeiro Master

A conta Master não é hardcoded no repositório público. O bootstrap usa variáveis protegidas do ambiente do servidor.

Campos aceitos:
- matrícula;
- nome completo;
- e-mail institucional;
- telefone;
- cargo/função;
- unidade/lotação;
- senha inicial.

O bootstrap cria a organização, o usuário, vincula o papel `MASTER`, exige troca da senha inicial e marca MFA como obrigatório.

## Segurança inicial

- hash Argon2id;
- cookie HTTP-only;
- sessão revogável armazenada no banco;
- expiração configurável;
- bloqueio por 15 minutos após 5 tentativas inválidas;
- rate limit no endpoint de login;
- auditoria de login, falha, bloqueio, logout e bootstrap;
- MFA preparado no modelo de dados.

## Próximas entregas desta área

1. fluxo de troca obrigatória de senha;
2. TOTP/MFA e recovery codes;
3. administração de usuários, papéis e permissões;
4. revogação de sessões;
5. política de senhas configurável.
