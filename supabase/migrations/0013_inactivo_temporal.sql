-- =====================================================================
-- INACTIVO TEMPORAL (p. ej. incapacidad)
-- Usa el estatus existente 'suspendido' (en pantalla: "Inactivo temporal").
-- Mientras está inactivo no se generan mensualidades. Al reactivarse:
--   inactivo menos de 1 año  → no paga reinscripción
--   inactivo 1 año o más     → paga reinscripción
-- =====================================================================

alter table academia.students
  add column if not exists inactive_since  date,
  add column if not exists inactive_until  date,   -- regreso estimado (opcional)
  add column if not exists inactive_reason text;
