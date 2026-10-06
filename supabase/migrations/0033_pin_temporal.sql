-- =====================================================================
-- PIN TEMPORAL
-- Cuando administración asigna un PIN, es temporal: la primera vez que la persona
-- entra con él, la plataforma le pide escoger su PIN personal.
-- =====================================================================
alter table academia.team_members add column if not exists pin_must_change boolean not null default false;
alter table academia.team_members add column if not exists pin_temp text; -- PIN temporal visible sólo para Jany hasta que la persona escoge el suyo
