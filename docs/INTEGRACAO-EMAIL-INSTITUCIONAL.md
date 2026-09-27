# Integração de e-mail institucional — Prefeitura de Ubatuba

## Endereços
- Webmail: https://webmail.ubatuba.sp.gov.br/
- Servidor institucional: mail.ubatuba.sp.gov.br

O domínio municipal publica mail.ubatuba.sp.gov.br como MX. As portas permanecem configuráveis porque a política técnica do servidor pode mudar.

## Funções no SIGDEC
- envio por SMTP autenticado;
- consulta da caixa de entrada por IMAP em modo somente leitura;
- acesso direto ao Webmail oficial para operações completas;
- auditoria de envio sem armazenar senha nem conteúdo integral da mensagem.

## Segurança
As credenciais são fornecidas somente por variáveis de ambiente no servidor:
- INSTITUTIONAL_MAIL_USER
- INSTITUTIONAL_MAIL_PASSWORD

Não devem ser versionadas, armazenadas em frontend, copiadas para banco comum ou exibidas em logs.

## Configuração padrão
- INSTITUTIONAL_SMTP_HOST=mail.ubatuba.sp.gov.br
- INSTITUTIONAL_SMTP_PORT=465
- INSTITUTIONAL_SMTP_SECURE=true
- INSTITUTIONAL_IMAP_HOST=mail.ubatuba.sp.gov.br
- INSTITUTIONAL_IMAP_PORT=993
- INSTITUTIONAL_IMAP_SECURE=true

Os valores de porta são padrões configuráveis e devem ser ajustados conforme confirmação da SMTI.

## Permissões
- communications.read: consultar caixa de entrada/status;
- communications.manage: enviar e-mail;
- integrations.manage: testar a integração.

## Limitações deliberadas
O SIGDEC não exclui, move ou marca mensagens no servidor IMAP nesta fase. A caixa é consultada em modo somente leitura para evitar alterações acidentais.
