-- =====================================================================
-- PAGOS DE GASTOS EN PARTES
-- Cada parte (anticipo, pago 1, pago 2…) con su fecha programada y la
-- fecha en que se pagó (vacía = pendiente). Así se sabe qué falta pagar,
-- aparece en el calendario y como pendiente en el Dashboard.
-- =====================================================================

create table if not exists academia.expense_installments (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references academia.expenses (id) on delete cascade,
  n           smallint not null check (n >= 0),          -- 0 = anticipo
  due_date    date not null,
  amount      numeric(10,2) not null check (amount >= 0),
  paid_on     date,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (expense_id, n)
);
create index if not exists expense_installments_due_idx on academia.expense_installments (due_date) where paid_on is null;

alter table academia.expense_installments enable row level security;
create policy expense_installments_admin on academia.expense_installments for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy expense_installments_open_mode on academia.expense_installments for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.expense_installments to authenticated, anon;

-- Gastos en partes que ya existían: el anticipo (o el primer pago si no hubo) ya se dio;
-- los demás quedan pendientes, uno por mes.
insert into academia.expense_installments (expense_id, n, due_date, amount, paid_on)
select e.id, 0, s.start, e.down_payment, s.start
from academia.expenses e
cross join lateral (select coalesce(e.paid_on, make_date(coalesce(e.paid_year, extract(year from current_date)::int), coalesce(e.paid_month, 1), 1)) as start) s
where e.frequency = 'partes' and coalesce(e.down_payment, 0) > 0
  and not exists (select 1 from academia.expense_installments i where i.expense_id = e.id)
union all
select e.id, g.n,
       (s.start + make_interval(months => g.n - case when coalesce(e.down_payment, 0) > 0 then 0 else 1 end))::date,
       round((e.amount - coalesce(e.down_payment, 0)) / greatest(coalesce(e.installments, 1), 1), 2),
       case when coalesce(e.down_payment, 0) = 0 and g.n = 1 then s.start end
from academia.expenses e
cross join lateral (select coalesce(e.paid_on, make_date(coalesce(e.paid_year, extract(year from current_date)::int), coalesce(e.paid_month, 1), 1)) as start) s
cross join lateral generate_series(1, greatest(coalesce(e.installments, 1), 1)) as g(n)
where e.frequency = 'partes'
  and not exists (select 1 from academia.expense_installments i where i.expense_id = e.id);

-- ---------------------------------------------------------------------
-- PRÉSTAMOS A RANCHO SECO
-- Un préstamo es un "gasto" de tipo prestamo: quién prestó, cuándo, y sus
-- pagos (expense_installments) con fecha. No cuenta como gasto de operación
-- en la ganancia por categoría, pero sí como salida de dinero en el corte.
-- ---------------------------------------------------------------------
alter table academia.expenses
  add column if not exists kind text not null default 'gasto' check (kind in ('gasto', 'prestamo')),
  add column if not exists lender text,
  add column if not exists received_on date;

-- ---------------------------------------------------------------------
-- CORTES DE CAJA
-- Se hace cuando se paga a los profes (normalmente miércoles): cuánto se
-- contó en caja y a dónde se fue el dinero (caja chica, ahorro Chivas…).
-- ---------------------------------------------------------------------
create table if not exists academia.cash_cuts (
  id            uuid primary key default gen_random_uuid(),
  cut_date      date not null default current_date,
  period_from   date not null,
  period_to     date not null,
  income        numeric(12,2) not null default 0,   -- cobros del periodo
  outflow       numeric(12,2) not null default 0,   -- pagos del periodo (sueldos, gastos, préstamos)
  counted       numeric(12,2) not null default 0,   -- dinero contado al hacer el corte
  distribution  jsonb not null default '[]'::jsonb, -- [{ "to": "Caja chica", "amount": 2000 }, …]
  notes         text,
  created_at    timestamptz not null default now(),
  check (period_to >= period_from)
);
create index if not exists cash_cuts_date_idx on academia.cash_cuts (cut_date desc);
alter table academia.cash_cuts enable row level security;
create policy cash_cuts_admin on academia.cash_cuts for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy cash_cuts_open_mode on academia.cash_cuts for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.cash_cuts to authenticated, anon;
