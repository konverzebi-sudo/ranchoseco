-- =====================================================================
-- UNIFORME DEL PARTIDO: rayado o liso (sale en el mensaje de convocatoria)
-- =====================================================================
alter table academia.matches add column if not exists uniform text check (uniform is null or uniform in ('rayado', 'liso'));
