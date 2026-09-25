ALTER TABLE field_positions
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

UPDATE field_positions
SET captured_at = recorded_at
WHERE captured_at IS NULL;

COMMENT ON COLUMN field_positions.recorded_at IS 'Horário em que a posição foi registrada pelo servidor SIGDEC.';
COMMENT ON COLUMN field_positions.captured_at IS 'Horário informado pelo dispositivo para a coleta da geolocalização.';
