-- =====================================================================
-- PIN TEMPORAL
-- Cuando administración asigna un PIN, es temporal: la primera vez que la persona
-- entra con él, la plataforma le pide escoger su PIN personal.
-- =====================================================================
alter table academia.team_members add column if not exists pin_must_change boolean not null default false;
