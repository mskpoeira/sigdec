INSERT INTO permissions(code,description) VALUES
('audit.read','Consultar trilha de auditoria e registro de atividades')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='audit.read'
WHERE r.code='MASTER'
ON CONFLICT DO NOTHING;
