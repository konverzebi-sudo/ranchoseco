-- =====================================================================
-- EQUIPO RANCHO SECO Y BITÁCORA
-- - team_members: las personas del equipo (quién recibe pagos, quién registra).
--   Se escoge de esta lista para que cada quien quede siempre con el mismo nombre.
-- - notifications.actor: quién hizo cada movimiento (la bitácora del Dashboard).
-- =====================================================================
create table if not exists academia.team_members (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique,
  role        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table academia.team_members enable row level security;
drop policy if exists team_members_admin on academia.team_members;
create policy team_members_admin on academia.team_members for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists team_members_open_mode on academia.team_members;
create policy team_members_open_mode on academia.team_members for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.team_members to authenticated, anon;

-- Punto de partida: los profesores activos y quienes reciben el reporte del corte
insert into academia.team_members (full_name, role)
select c.full_name, 'Profesor' from academia.coaches c where c.active
on conflict (full_name) do nothing;
insert into academia.team_members (full_name, role) values ('Marco DL', 'Administración'), ('Junior DR', 'Administración')
on conflict (full_name) do nothing;

alter table academia.notifications add column if not exists actor text;
create index if not exists notifications_created_idx on academia.notifications (created_at desc);
