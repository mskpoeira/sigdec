INSERT INTO permissions (code, description) VALUES
('dispatch.update', 'Atualizar o andamento de despachos')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'dispatch.update'
WHERE r.code = 'MASTER'
ON CONFLICT DO NOTHING;
