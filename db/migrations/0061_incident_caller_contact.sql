ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS caller_phone_type varchar(12),
  ADD COLUMN IF NOT EXISTS caller_phone_whatsapp boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='incidents_caller_phone_type_check'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_caller_phone_type_check
      CHECK (caller_phone_type IS NULL OR caller_phone_type IN ('LANDLINE','MOBILE'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='incidents_whatsapp_requires_phone_check'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_whatsapp_requires_phone_check
      CHECK (caller_phone_whatsapp=false OR caller_phone IS NOT NULL);
  END IF;
END
$$;

COMMENT ON COLUMN incidents.caller_phone_type IS
  'Classificação do telefone informado pelo solicitante: LANDLINE (fixo) ou MOBILE (celular).';

COMMENT ON COLUMN incidents.caller_phone_whatsapp IS
  'Indica se o número informado pelo solicitante possui WhatsApp.';
