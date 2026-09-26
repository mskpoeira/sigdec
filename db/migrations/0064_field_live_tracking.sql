ALTER TABLE field_positions
  ADD COLUMN IF NOT EXISTS speed_mps double precision,
  ADD COLUMN IF NOT EXISTS heading_degrees double precision,
  ADD COLUMN IF NOT EXISTS tracking_session_id uuid;

ALTER TABLE field_positions
  DROP CONSTRAINT IF EXISTS field_positions_speed_check,
  ADD CONSTRAINT field_positions_speed_check CHECK (speed_mps IS NULL OR speed_mps >= 0),
  DROP CONSTRAINT IF EXISTS field_positions_heading_check,
  ADD CONSTRAINT field_positions_heading_check CHECK (heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360));

CREATE INDEX IF NOT EXISTS field_positions_tracking_session_idx
  ON field_positions(tracking_session_id, recorded_at DESC)
  WHERE tracking_session_id IS NOT NULL;

COMMENT ON COLUMN field_positions.speed_mps IS 'Velocidade informada pelo dispositivo em metros por segundo.';
COMMENT ON COLUMN field_positions.heading_degrees IS 'Rumo informado pelo dispositivo, em graus a partir do norte.';
COMMENT ON COLUMN field_positions.tracking_session_id IS 'Identificador da sessão contínua de rastreamento em campo.';
