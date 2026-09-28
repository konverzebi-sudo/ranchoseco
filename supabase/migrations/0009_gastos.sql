-- =====================================================================
-- CONTROL DE GASTOS GENERALES
-- Gastos de la academia que no son de una sola categoría (regalías, renta,
-- seguro, personal general…). Se capturan a mano y se reparten entre los
-- alumnos activos: cada categoría carga la parte proporcional a su número
-- de alumnos.
--
-- Equivalente mensual para los reportes:
--   semanal × 52/12 · quincenal × 2 · mensual × 1 · anual ÷ 12
--   único: completo sólo en el mes en que se paga (paid_month)
-- =====================================================================

create table academia.expenses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  amount      numeric(10,2) not null check (amount >= 0),
  frequency   text not null default 'mensual'
              check (frequency in ('semanal', 'quincenal', 'mensual', 'anual', 'unico')),
  paid_month  smallint check (paid_month between 1 and 12),   -- mes en que se paga (anual / único)
  paid_year   smallint,                                       -- año (sólo para gastos únicos)
  notes       text,
  active      boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table academia.expenses enable row level security;

create policy expenses_admin on academia.expenses for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy expenses_open_mode on academia.expenses for all to anon
  using (academia.open_mode()) with check (academia.open_mode());

grant select, insert, update, delete on academia.expenses to authenticated, anon;
