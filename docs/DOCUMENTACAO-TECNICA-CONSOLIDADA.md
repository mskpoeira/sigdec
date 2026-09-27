# Documentação Técnica Consolidada — SIGDEC

## Visão geral
O SIGDEC é uma aplicação web para gestão integrada de Defesa Civil. O repositório é organizado em aplicações Web e API, banco PostgreSQL/PostGIS, migrações SQL, automações de CI/CD e documentação.

## Componentes
- **Web:** interface operacional e administrativa.
- **API:** autenticação, autorização e regras de negócio.
- **PostgreSQL 16 + PostGIS:** dados transacionais e geoespaciais.
- **Redis:** serviços auxiliares que dependam de cache/coordenação conforme configuração da instalação.
- **MinIO:** armazenamento compatível com objetos conforme configuração da instalação.
- **Caddy:** terminação HTTPS/reverse proxy na homologação autorizada.
- **GitHub Actions:** validação e deploy automatizado.

## Princípios de arquitetura
1. Autorização é verificada na API; ocultar menu não é mecanismo de segurança.
2. Alterações críticas devem ser transacionais.
3. Migrações são versionadas e executadas em ordem.
4. Segredos não pertencem ao repositório.
5. Dados históricos devem ser preservados quando um cadastro é desativado.
6. Ações administrativas relevantes devem ser auditáveis.
7. Integrações externas não devem impedir operação manual segura quando o domínio permitir fallback.

## Autenticação e usuários
A matrícula é normalizada antes do uso de autenticação. Usuários possuem perfis e permissões. Perfis elevados podem exigir MFA. Redefinição administrativa gera senha temporária e revoga sessões/tokens aplicáveis.

### Contatos
A estrutura `contact_points` suporta múltiplos contatos por proprietário. Tipos atuais:
- PHONE;
- EMAIL.

Proprietários incluem, conforme migrações vigentes:
- USER;
- VOLUNTEER;
- SHELTER_RESPONSIBLE.

Campos legados de telefone/e-mail podem permanecer como espelho do contato principal durante a transição para compatibilidade.

## Telefones
A interface normaliza para dígitos e aplica máscara brasileira. Com DDD:
- 10 dígitos: LANDLINE;
- 11 dígitos: MOBILE.

WhatsApp aplica-se a celular; ramal é informação complementar de fixo quando suportada pela interface. A classificação visual não deve substituir validações de negócio necessárias.

## Endereços
Endereços estruturados utilizam CEP, logradouro, número, complemento, bairro, cidade e UF. A consulta de CEP é conveniência de interface e deve falhar de forma não bloqueante, permitindo preenchimento manual.

## Assistência e abrigos
Abrigos possuem capacidade e estado operacional. A admissão de famílias deve respeitar capacidade com proteção transacional contra concorrência. Responsáveis de abrigo possuem contatos múltiplos. Saídas precisam atualizar corretamente a ocupação.

## Estoque humanitário
Movimentações devem preservar unidade, quantidade, tipo, referência e histórico. Entregas não podem resultar em saldo inconsistente. Alertas de duplicidade devem ser tratados explicitamente.

## Monitoramento
Estações armazenam tipo, provedor, referência externa e localização. Leituras preservam métrica, unidade, horário e origem. Limiares podem gerar eventos. Chaves de ingestão são armazenadas apenas como hash; o token em claro deve ser exibido somente no momento autorizado de criação/rotação.

## Auditoria
`audit_logs` registra ações relevantes com ator, ação, entidade, IP/user-agent quando disponíveis e estados anterior/posterior quando apropriado. Segredos não devem integrar payload de auditoria.

## Banco e migrações
- PostgreSQL 16.
- PostGIS para recursos geográficos.
- Migrações em `db/migrations`.
- Migração nova deve ser idempotente quando o padrão do projeto exigir e validada pelo CI.
- Alteração destrutiva exige plano explícito de preservação/rollback.

## CI
Antes do merge, o pipeline deve validar ao menos:
1. instalação de dependências;
2. typecheck;
3. testes;
4. migrações/banco quando configurado;
5. build/verificações adicionais definidas no workflow.

PR vermelho não deve ser mergeado.

## Deploy de homologação
Fluxo esperado:
1. merge na MAIN com CI verde;
2. workflow de deploy autorizado;
3. atualização de `/opt/sigdec` ou estratégia vigente;
4. serviços de infraestrutura disponíveis;
5. migrações pendentes;
6. API/Web;
7. proxy HTTPS;
8. health check;
9. teste de login;
10. confirmação do SHA publicado.

## Segredos
Nunca registrar em:
- commits;
- logs;
- documentação;
- respostas de chat;
- screenshots;
- arquivos públicos.

Usar exclusivamente o mecanismo de secrets/configuração autorizado do ambiente.

## Módulos funcionais
A interface contempla, conforme permissões e versão: Painel, Apresentação, Ocorrências, Campo, Monitoramento, Assistência, Voluntários, Vistorias, Comunicações, SCO, Documentos, Planejamento, Resiliência, Apoios, Capacitação, Ajuda Mútua, Operações Sazonais, Simulados, Gestão, Continuidade, Gestão de Riscos, Alertas, Danos, Infraestruturas, Inteligência, Assistência a Animais e Administração.

## Integrações
Integrações devem ser desacopladas e auditáveis. Indisponibilidade de serviço externo não deve resultar em perda silenciosa de dados. Para integrações que alterem dados, definir autenticação, autorização, idempotência, timeout e tratamento de erro.

## Convenções de alteração
- uma mudança funcional relevante deve incluir código, testes e documentação aplicável;
- preservar compatibilidade durante migrações graduais;
- evitar duplicação de componentes transversais (telefone, e-mail, endereço);
- corrigir a causa, não apenas o sintoma do CI;
- registrar pendências externas separadamente de defeitos internos.

## Critério de fechamento de ciclo
Um ciclo só é considerado fechado quando:
- CI do HEAD está verde;
- merge foi concluído;
- CI da MAIN está verde;
- homologação contém o mesmo SHA esperado;
- health/login e fluxos críticos foram validados dentro do acesso disponível;
- auditoria pós-deploy foi executada;
- pendências internas corrigíveis foram zeradas ou explicitamente justificadas;
- manual/documentação foram atualizados.
