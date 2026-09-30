-- =====================================================================
-- MESES EN QUE NO SE PAGA UN GASTO MENSUAL
-- Ej. Regalías Chivas: $7,500 al mes, pero julio y agosto no se pagan.
-- =====================================================================
alter table academia.expenses add column if not exists skip_months smallint[] not null default '{}';
