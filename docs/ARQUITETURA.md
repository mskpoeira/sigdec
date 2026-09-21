# Arquitetura inicial

- `apps/web`: interface principal.
- `apps/api`: API HTTP.
- `db`: migrações PostgreSQL/PostGIS.
- `docs`: requisitos e decisões.

## Infraestrutura

PostgreSQL/PostGIS para dados; Redis para cache/filas; MinIO/S3 para anexos.

## Regras

1. Frontend não acessa banco diretamente.
2. Todo ato relevante produz auditoria.
3. Integrações ficam desacopladas do domínio.
4. Geodados usam PostGIS.
5. Anexos recebem hash e metadados.
6. Módulos são ativados por permissão e feature flag.
7. Uma identidade única pode ter escopos diferentes por órgão/função.
