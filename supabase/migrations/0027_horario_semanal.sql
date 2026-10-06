-- =====================================================================
-- HORARIO SEMANAL DE ENTRENAMIENTOS POR CATEGORÍA
-- weekly_schedule: [{ "dow": 1..7 (1 = lunes), "start": "17:00", "end": "18:30" }]
-- Los entrenamientos de las próximas 2 semanas se crean solos con ese horario.
-- schedule_generated_until: hasta qué día ya se crearon (si se borra uno, no vuelve).
-- =====================================================================
alter table academia.categories
  add column if not exists weekly_schedule jsonb not null default '[]'::jsonb,
  add column if not exists schedule_generated_until date;
