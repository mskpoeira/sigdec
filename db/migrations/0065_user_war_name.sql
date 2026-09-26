ALTER TABLE users
  ADD COLUMN IF NOT EXISTS war_name varchar(80);

COMMENT ON COLUMN users.war_name IS
  'Nome de guerra ou nome curto preferencial exibido na interface do SIGDEC.';
