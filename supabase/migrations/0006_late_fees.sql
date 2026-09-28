-- =====================================================================
-- RECARGOS POR PAGO TARDÍO
-- Regla de la academia: mensualidad pagadera del día 1 al 5; a partir del
-- día 6 se suma un recargo fijo por cada día de retraso.
--
-- - El recargo corre mientras la mensualidad (el importe base) no esté cubierta.
--   Cuando los pagos cubren el importe base, el recargo se congela y sólo queda
--   pendiente lo acumulado.
-- - Cada cargo guarda la tarifa vigente al crearse (cambiar la configuración
--   no altera cargos anteriores).
-- - Administración puede condonar (perdonar) recargo por cargo.
-- =====================================================================

alter table academia.settings add column late_fee_per_day numeric(10,2) not null default 0
  check (late_fee_per_day >= 0);

create or replace function academia.current_late_fee()
returns numeric language sql stable security definer set search_path = academia, public as $$
  select coalesce((select late_fee_per_day from academia.settings where id = 1), 0)
$$;

alter table academia.fees
  add column late_fee_per_day numeric(10,2) not null default academia.current_late_fee() check (late_fee_per_day >= 0),
  add column late_fee_waived  numeric(10,2) not null default 0 check (late_fee_waived >= 0);

drop view academia.student_accounts;
drop view academia.fee_balances;

create view academia.fee_balances with (security_invoker = true) as
with cum as (
  select p.fee_id, p.paid_at,
         sum(p.amount) over (partition by p.fee_id order by p.paid_at, p.created_at, p.id
                             rows between unbounded preceding and current row) as running
  from academia.payments p
),
agg as (
  select fee_id, sum(amount) as paid, max(paid_at) as last_paid_at
  from academia.payments group by fee_id
)
select
  f.id, f.student_id, f.concept, f.period, f.amount, f.due_date, f.notes, f.created_at,
  f.late_fee_per_day, f.late_fee_waived,
  d.late_days,
  x.late_fee,
  (f.amount + x.late_fee)::numeric(10,2)                           as total_due,
  coalesce(a.paid, 0)::numeric(10,2)                               as paid,
  (f.amount + x.late_fee - coalesce(a.paid, 0))::numeric(10,2)     as balance,
  a.last_paid_at,
  case
    when coalesce(a.paid, 0) >= f.amount + x.late_fee then 'pagado'
    when current_date > f.due_date then 'vencido'
    when coalesce(a.paid, 0) > 0 then 'parcial'
    else 'pendiente'
  end as status
from academia.fees f
left join agg a on a.fee_id = f.id
cross join lateral (
  select greatest(0, coalesce(
    (select min(c.paid_at) from cum c where c.fee_id = f.id and c.running >= f.amount),
    current_date) - f.due_date)::int as late_days
) d
cross join lateral (
  select greatest(0, d.late_days * f.late_fee_per_day - f.late_fee_waived)::numeric(10,2) as late_fee
) x;

create view academia.student_accounts with (security_invoker = true) as
select
  s.id as student_id,
  coalesce(sum(fb.balance), 0)::numeric(10,2) as balance,
  coalesce(sum(fb.balance) filter (where fb.status = 'vencido'), 0)::numeric(10,2) as overdue,
  coalesce(sum(fb.late_fee), 0)::numeric(10,2) as late_fees,
  count(*) filter (where fb.status = 'vencido')                 as overdue_count,
  count(*) filter (where fb.status in ('pendiente','parcial'))   as pending_count,
  min(fb.due_date) filter (where fb.balance > 0)                 as next_due,
  case
    when count(*) filter (where fb.status = 'vencido') > 0 then 'vencido'
    when count(*) filter (where fb.status = 'parcial') > 0 then 'parcial'
    when count(*) filter (where fb.status = 'pendiente') > 0 then 'pendiente'
    else 'al_corriente'
  end as status
from academia.students s
left join academia.fee_balances fb on fb.student_id = s.id
group by s.id;

grant select on academia.fee_balances, academia.student_accounts to authenticated, anon;

-- Un pago no puede exceder el saldo real (mensualidad + recargo acumulado).
create or replace function academia.validate_payment()
returns trigger language plpgsql security definer set search_path = academia, public as $$
declare
  fb record;
  available numeric;
begin
  select * into fb from academia.fee_balances where id = new.fee_id;
  if fb.student_id is distinct from new.student_id then
    raise exception 'El pago no corresponde al alumno del cargo';
  end if;
  available := fb.balance + case when tg_op = 'UPDATE' then old.amount else 0 end;
  if new.amount > available then
    raise exception 'El pago (%) excede el saldo pendiente (%)', new.amount, available;
  end if;
  return new;
end $$;
