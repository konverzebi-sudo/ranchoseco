-- =====================================================================
-- RECARGO POR MES DE ATRASO (reemplaza el recargo diario)
-- Regla: la mensualidad se paga del día 1 al día de vencimiento (5).
-- Si no se cubre, se suma el recargo una vez; y otra vez por cada mes
-- adicional que pase sin cubrirse:
--   vence 5-sep · pagado 20-sep → 1 recargo · pagado 6-oct → 2 recargos
-- El recargo deja de correr cuando se cubre el importe de la mensualidad.
-- =====================================================================

alter table academia.settings rename column late_fee_per_day to late_fee_amount;
alter table academia.fees     rename column late_fee_per_day to late_fee_amount;

create or replace function academia.current_late_fee()
returns numeric language sql stable security definer set search_path = academia, public as $$
  select coalesce((select late_fee_amount from academia.settings where id = 1), 0)
$$;

-- Meses de atraso: 0 si se cubrió a tiempo; 1 desde el día siguiente al vencimiento,
-- y uno más por cada mes completo adicional.
create or replace function academia.late_months(due date, settled date)
returns int language sql immutable as $$
  select case when settled <= due then 0
    else 1 + (extract(year from age(settled, due + 1)) * 12 + extract(month from age(settled, due + 1)))::int
  end
$$;

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
  f.discount, f.discount_reason, f.review,
  f.late_fee_amount, f.late_fee_waived,
  d.late_months,
  x.late_fee,
  (f.amount - f.discount + x.late_fee)::numeric(10,2)                        as total_due,
  coalesce(a.paid, 0)::numeric(10,2)                                         as paid,
  (f.amount - f.discount + x.late_fee - coalesce(a.paid, 0))::numeric(10,2)  as balance,
  a.last_paid_at,
  case
    when coalesce(a.paid, 0) >= f.amount - f.discount + x.late_fee then 'pagado'
    when f.review is not null then 'por_confirmar'
    when current_date > f.due_date then 'vencido'
    when coalesce(a.paid, 0) > 0 then 'parcial'
    else 'pendiente'
  end as status
from academia.fees f
left join agg a on a.fee_id = f.id
cross join lateral (
  select case when f.review is not null then 0 else academia.late_months(f.due_date, coalesce(
    (select min(c.paid_at) from cum c where c.fee_id = f.id and c.running >= f.amount - f.discount),
    current_date)) end as late_months
) d
cross join lateral (
  select greatest(0, d.late_months * f.late_fee_amount - f.late_fee_waived)::numeric(10,2) as late_fee
) x;

create view academia.student_accounts with (security_invoker = true) as
select
  s.id as student_id,
  coalesce(sum(fb.balance), 0)::numeric(10,2) as balance,
  coalesce(sum(fb.balance) filter (where fb.status = 'vencido'), 0)::numeric(10,2) as overdue,
  coalesce(sum(fb.late_fee), 0)::numeric(10,2) as late_fees,
  coalesce(sum(fb.discount), 0)::numeric(10,2) as scholarships,
  count(*) filter (where fb.status = 'vencido')                 as overdue_count,
  count(*) filter (where fb.status in ('pendiente','parcial'))   as pending_count,
  count(*) filter (where fb.status = 'por_confirmar')            as review_count,
  min(fb.due_date) filter (where fb.balance > 0)                 as next_due,
  case
    when count(*) filter (where fb.status = 'vencido') > 0 then 'vencido'
    when count(*) filter (where fb.status = 'por_confirmar') > 0 then 'por_confirmar'
    when count(*) filter (where fb.status = 'parcial') > 0 then 'parcial'
    when count(*) filter (where fb.status = 'pendiente') > 0 then 'pendiente'
    else 'al_corriente'
  end as status
from academia.students s
left join academia.fee_balances fb on fb.student_id = s.id
group by s.id;

grant select on academia.fee_balances, academia.student_accounts to authenticated, anon;
grant execute on function academia.late_months(date, date) to authenticated, anon;
