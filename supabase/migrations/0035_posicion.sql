-- =====================================================================
-- POSICIÓN DEL JUGADOR (se pone en su perfil y sale sola en cada partido)
-- =====================================================================
alter table academia.students add column if not exists position text;
