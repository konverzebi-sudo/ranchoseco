-- =====================================================================
-- CONFIGURACIÓN DE LA CAJA CHIVAS
-- Cuánto va de cada inscripción a credencial y playera (se puede cambiar
-- y aplica de ahí en adelante) y el seguro anual entre la meta mínima de alumnos.
-- =====================================================================
alter table academia.settings add column if not exists chivas_playera numeric not null default 100;
alter table academia.settings add column if not exists chivas_credencial numeric not null default 150;
alter table academia.settings add column if not exists seguro_anual numeric not null default 13000;
alter table academia.settings add column if not exists meta_alumnos int not null default 150;
