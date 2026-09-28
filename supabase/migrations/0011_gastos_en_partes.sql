-- =====================================================================
-- GASTOS EN PARTES
-- Un gasto se puede pagar con un anticipo y el resto en varios pagos
-- mensuales iguales:
--   total 3,000 · anticipo 1,000 en oct · 4 pagos → 500 nov, dic, ene, feb
-- El anticipo cae en paid_month/paid_year; los pagos, en los meses
-- siguientes. Sin anticipo, el primer pago cae en paid_month.
-- =====================================================================

alter table academia.expenses drop constraint if exists expenses_frequency_check;
alter table academia.expenses add constraint expenses_frequency_check
  check (frequency in ('semanal', 'quincenal', 'mensual', 'anual', 'unico', 'partes'));

alter table academia.expenses
  add column if not exists down_payment numeric(10,2) check (down_payment is null or down_payment >= 0),
  add column if not exists installments smallint      check (installments is null or installments between 1 and 60);

notify pgrst, 'reload schema';
