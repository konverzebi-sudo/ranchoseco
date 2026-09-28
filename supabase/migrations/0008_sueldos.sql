-- =====================================================================
-- SUELDOS DE PROFESORES
-- Tabla aparte (y no una columna en coaches) para que, al cerrar el modo
-- abierto, sólo administración vea los sueldos.
-- El reporte por categoría usa el costo mensual:
--   semanal × 52/12, quincenal × 2, mensual × 1
-- y lo reparte en partes iguales entre las categorías del profesor.
-- =====================================================================

create table academia.coach_pay (
  coach_id    uuid primary key references academia.coaches (id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  frequency   text not null default 'semanal' check (frequency in ('semanal', 'quincenal', 'mensual')),
  updated_at  timestamptz not null default now()
);

alter table academia.coach_pay enable row level security;

create policy coach_pay_admin on academia.coach_pay for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy coach_pay_open_mode on academia.coach_pay for all to anon
  using (academia.open_mode()) with check (academia.open_mode());

grant select, insert, update, delete on academia.coach_pay to authenticated, anon;
