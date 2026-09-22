# SIGDEC v0.8 — Campo, mapa e vistorias

## Entregue nesta fase

- mapa operacional das ocorrências ativas com coordenadas;
- seleção e centralização da ocorrência no OpenStreetMap;
- registro voluntário da posição atual do agente pelo navegador;
- histórico geográfico de posições com PostGIS;
- visualização das últimas posições informadas nas últimas 24 horas;
- vistorias preventivas, estruturais, de árvores, encostas, alagamentos e pós-evento;
- vínculo opcional da vistoria com uma ocorrência;
- endereço, bairro, referência, coordenadas e agendamento;
- checklist técnico inicial;
- fluxo controlado: agendada → em andamento → concluída ou cancelada;
- classificação de risco e conclusão técnica obrigatória;
- registro da vistoria na linha do tempo da ocorrência;
- auditoria de criação e mudança de situação;
- permissões granulares para campo e vistorias;
- interface responsiva para celular e computador.

## Segurança e privacidade

A localização só é enviada após ação explícita do usuário e autorização do navegador.
O sistema mantém o histórico necessário à operação e exibe no mapa apenas posições
da própria organização registradas nas últimas 24 horas. Acesso e alteração dependem
de sessão válida, troca da senha temporária e permissões RBAC.

## Banco de dados

A migração `0007_field_inspections.sql` adiciona:

- `field_positions`;
- `inspections`;
- `inspection_checklist_items`;
- índices temporais e geoespaciais;
- permissões `field.read`, `field.location.update`,
  `inspections.read` e `inspections.manage`.

## Próxima evolução

A fase seguinte deverá tratar documentos técnicos: laudos, pareceres, autos de
interdição, declarações, modelos versionados, assinatura e geração de PDF.
