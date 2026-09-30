-- =====================================================================
-- CLASE MUESTRA
-- Un niño que viene a probar queda como "muestra": sale en la lista de
-- asistencia de su categoría, no se le cobra y no cuenta como alumno activo
-- hasta que se cierra su registro (pasa a activo) o no se queda (baja).
-- =====================================================================
alter type academia.student_status add value if not exists 'muestra';
alter table academia.students add column if not exists trial_on date;
