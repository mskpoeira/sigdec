WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id,path
           ORDER BY active DESC,sort_order ASC,created_at ASC,id ASC
         ) AS rn
    FROM navigation_items
)
DELETE FROM navigation_items n
USING ranked r
WHERE n.id=r.id
  AND r.rn>1;

CREATE UNIQUE INDEX IF NOT EXISTS navigation_items_org_path_uidx
  ON navigation_items(organization_id,path);

COMMENT ON INDEX navigation_items_org_path_uidx IS
  'Evita atalhos duplicados para a mesma rota dentro da mesma organização.';
