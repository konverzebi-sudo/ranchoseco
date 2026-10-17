-- Caja Chivas: los gastos también pueden salir de la Caja Chivas o de sus mini cajas
alter table academia.expenses drop constraint if exists expenses_paid_from_check;
alter table academia.expenses add constraint expenses_paid_from_check
  check (paid_from in ('caja', 'ahorro', 'apartado', 'uniformes', 'chivas', 'chivas_playeras', 'chivas_credenciales', 'otro'));
