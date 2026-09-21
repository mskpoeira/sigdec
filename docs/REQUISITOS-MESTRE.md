# Documento Mestre de Requisitos — SIGDEC

## Objetivo

O SIGDEC será a plataforma municipal integrada para prevenção, preparação, monitoramento, alertamento, atendimento, despacho, comando, resposta, assistência humanitária, voluntariado, logística, documentação, recuperação e gestão de riscos e desastres.

## Arquitetura funcional

Os módulos compartilham identidade, auditoria e dados mestres, mas são ativáveis por permissão e feature flag. O operador do 199 vê uma interface simples; campo vê ocorrências e vistorias; Assistência Social vê famílias e abrigos; Fundo Social vê necessidades, doações e entregas; técnicos veem documentos técnicos; coordenação vê a operação consolidada.

## Domínios

1. Central 199 e triagem
2. Ocorrências
3. Despacho, equipes e viaturas
4. PWA de campo
5. Vistorias, interdições, laudos, pareceres e declarações
6. Registro e tratamento de riscos
7. Monitoramento ambiental e integrações especializadas
8. Alertas e protocolos
9. Gestão de desastre e SCO
10. Períodos operacionais, objetivos, tarefas e SITREP
11. Integração interinstitucional e ajuda mútua
12. Recursos, equipamentos, EPI e logística
13. Assistência humanitária, famílias, desalojados e desabrigados
14. Abrigos e pontos de apoio
15. Fundo Social, doações, estoque e distribuição
16. Voluntariado, competências, cursos, certificados e credenciamento
17. Comunicações e rádio
18. S2iD, COBRADE, FIDE e DMATE
19. Treinamento, simulados e AAR/plano de melhoria
20. Recuperação pós-desastre
21. Biblioteca institucional
22. Relatórios e BI
23. Administração, RBAC e feature flags
24. Auditoria, segurança, LGPD e cadeia de custódia
25. API, webhooks e integrações

## Voluntariado

O cadastro terá profissão, formação, cursos, especializações, aptidões declaradas e competências validadas, instituição, carga horária, certificado, validade, anexo, CNH, idiomas, radioamadorismo, disponibilidade, região de atuação e histórico.

Também manterá tamanhos necessários à mobilização: camiseta, calça, jaqueta, capa de chuva, colete, luva e numeração de calçado/bota. Vestuário e EPI serão separados e integrados ao estoque.

A mobilização considerará competência validada, credencial vigente, disponibilidade e requisitos da posição operacional.

## Assistência humanitária

Fluxo: Assistência identifica necessidade → solicitação humanitária → Fundo Social/estoque → separação → entrega → baixa → comprovante/relatório.

Itens: cesta básica, água, kit de higiene, kit de limpeza, colchão, cobertor, roupa, calçado, fraldas, itens infantis e kits configuráveis.

O sistema alertará possível duplicidade de entrega sem bloquear nova entrega justificada.

## Monitoramento

Plataformas especializadas existentes serão fontes integráveis. Dados de pluviômetros e sensores poderão entrar por API, webhook, importação ou sincronização autorizada. A ocorrência poderá preservar snapshot das condições ambientais no momento do atendimento.

## Segurança

Matrícula + senha; MFA para perfis estratégicos; RBAC; menor privilégio; auditoria append-only; versionamento; hash de anexos; segredos fora do Git; backups testados; modo offline.

## Fases

F1 Fundação e segurança.
F2 Central, ocorrências e despacho.
F3 Campo, mapa e vistorias.
F4 Documentos técnicos.
F5 SCO e desastres.
F6 Assistência e Fundo Social.
F7 Voluntariado.
F8 Riscos, monitoramento e alertas.
F9 S2iD.
F10 BI, recuperação e treinamentos.
F11 Integrações.
F12 Inteligência assistiva.
