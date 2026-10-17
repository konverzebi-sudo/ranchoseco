-- =====================================================================
-- REPARTO DE LA INSCRIPCIÓN (Caja Chivas)
-- Al cobrar una inscripción se anota cuánto va a cada mini caja:
-- playera de entrenamiento, credencial y seguro (lo demás queda libre).
-- =====================================================================
alter table academia.payments add column if not exists split jsonb;
comment on column academia.payments.split is 'Inscripción: {"playera": 100, "credencial": 150, "seguro": 73.33}';
