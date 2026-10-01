-- =====================================================================
-- UNIFORMES
-- Talla de cada niño y si ya se le entregó el uniforme y la playera de
-- entrenamiento (con la fecha en que se entregó).
-- =====================================================================
alter table academia.students
  add column if not exists uniform_size text,
  add column if not exists uniform_delivered_on date,
  add column if not exists training_shirt_delivered_on date;
