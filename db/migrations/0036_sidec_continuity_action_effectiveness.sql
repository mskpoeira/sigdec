ALTER TABLE sidec_continuity_action_items
  ADD COLUMN risk_id uuid REFERENCES risk_registers(id) ON DELETE SET NULL,
  ADD COLUMN recovery_action_id uuid REFERENCES recovery_actions(id) ON DELETE SET NULL,
  ADD COLUMN effectiveness varchar(20) NOT NULL DEFAULT 'NOT_EVALUATED'
    CHECK(effectiveness IN ('NOT_EVALUATED','EFFECTIVE','PARTIAL','INEFFECTIVE')),
  ADD COLUMN effectiveness_notes text,
  ADD COLUMN effectiveness_evaluated_at timestamptz,
  ADD COLUMN effectiveness_evaluated_by uuid REFERENCES users(id);

ALTER TABLE sidec_continuity_action_items
  ADD CONSTRAINT sidec_continuity_action_effectiveness_done_chk
  CHECK(effectiveness='NOT_EVALUATED' OR status='DONE');

CREATE INDEX sidec_continuity_action_items_risk_idx
  ON sidec_continuity_action_items(risk_id)
  WHERE risk_id IS NOT NULL;

CREATE INDEX sidec_continuity_action_items_recovery_idx
  ON sidec_continuity_action_items(recovery_action_id)
  WHERE recovery_action_id IS NOT NULL;

COMMENT ON COLUMN sidec_continuity_action_items.risk_id IS
  'Risco do SIGDEC relacionado à ação corretiva, definido deliberadamente pelo operador.';
COMMENT ON COLUMN sidec_continuity_action_items.recovery_action_id IS
  'Ação de recuperação do SIGDEC relacionada à ação corretiva, definida deliberadamente pelo operador.';
COMMENT ON COLUMN sidec_continuity_action_items.effectiveness IS
  'Avaliação humana posterior da eficácia da ação concluída; não é inferida automaticamente.';
