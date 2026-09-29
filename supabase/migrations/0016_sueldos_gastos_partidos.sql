-- =====================================================================
-- FECHA EN GASTOS DEL MES + HISTORIAL DE SUELDOS + ASISTENCIA A PARTIDOS
-- - expenses.paid_on: día en que se hizo un gasto de una sola vez
--   (para el desglose día a día).
-- - coach_pay_history: cada cambio de sueldo con su fecha, motivo y
--   nuevas responsabilidades.
-- =====================================================================

alter table academia.expenses add column if not exists paid_on date;

create table if not exists academia.coach_pay_history (
  id                uuid primary key default gen_random_uuid(),
  coach_id          uuid not null references academia.coaches (id) on delete cascade,
  amount            numeric(10,2) not null check (amount >= 0),
  frequency         text not null check (frequency in ('semanal', 'quincenal', 'mensual')),
  previous_amount   numeric(10,2),
  effective_date    date not null default current_date,
  reason            text,
  responsibilities  text,
  created_at        timestamptz not null default now()
);
create index if not exists coach_pay_history_coach_idx on academia.coach_pay_history (coach_id, effective_date);

alter table academia.coach_pay_history enable row level security;

create policy coach_pay_history_admin on academia.coach_pay_history for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy coach_pay_history_open_mode on academia.coach_pay_history for all to anon
  using (academia.open_mode()) with check (academia.open_mode());

grant select, insert, update, delete on academia.coach_pay_history to authenticated, anon;

-- Punto de partida: el sueldo actual de cada profesor
insert into academia.coach_pay_history (coach_id, amount, frequency, effective_date, reason)
select p.coach_id, p.amount, p.frequency, p.updated_at::date, 'Sueldo registrado al iniciar la plataforma'
from academia.coach_pay p
where not exists (select 1 from academia.coach_pay_history h where h.coach_id = p.coach_id);

-- Asistencia a partidos: el convocado que no llegó queda como falta;
-- el que no fue convocado no aparece en match_players y no cuenta como falta.
alter table academia.match_players add column if not exists attended boolean not null default true;

-- Historial de cambios de precios de la academia (mensualidad, día límite, recargo)
create table if not exists academia.settings_history (
  id          uuid primary key default gen_random_uuid(),
  field       text not null,
  label       text not null,
  old_value   text,
  new_value   text,
  reason      text,
  changed_at  timestamptz not null default now()
);
alter table academia.settings_history enable row level security;
create policy settings_history_admin on academia.settings_history for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy settings_history_open_mode on academia.settings_history for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.settings_history to authenticated, anon;
