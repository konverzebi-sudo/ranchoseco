-- =====================================================================
-- PIN DE ADMINISTRACIÓN
-- Sólo administración (Mili, Aby, Junior, Jany, Marco) ve los números.
-- Al escoger su nombre en "¿Quién eres?" se pide su PIN (se guarda cifrado).
-- Mientras no haya usuarios con contraseña, esto evita que un profe entre como directivo.
-- =====================================================================
alter table academia.team_members add column if not exists pin_hash text;
