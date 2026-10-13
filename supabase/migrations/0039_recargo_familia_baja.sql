-- =====================================================================
-- RECARGO POR FAMILIA (promo de hermanos)
-- Si varios hermanos se atrasan el mismo mes, se cobra UN solo recargo de $50
-- a la familia (lo lleva el primer hermano atrasado), no $50 por cada niño.
-- Lo que ya se pagó con recargo de cada hermano se respeta (own_late_fee).
-- =====================================================================
alter table academia.fees add column if not exists own_late_fee boolean not null default false;

-- Día en que se cubrió el importe de un cargo (sin contar recargo)
create or replace function academia.fee_settled_on(p_fee uuid, p_target numeric)
returns date language sql stable security definer set search_path = academia, public as $$
  select min(c.paid_at) from (
    select p.paid_at, sum(p.amount) over (order by p.paid_at, p.created_at, p.id rows between unbounded preceding and current row) as running
    from academia.payments p where p.fee_id = p_fee
  ) c where c.running >= p_target
$$;

-- ¿Ese cargo va atrasado (lleva recargo propio)?
create or replace function academia.fee_is_late(p_fee uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select f.review is null and academia.late_months(f.due_date, coalesce(academia.fee_settled_on(f.id, f.amount - f.discount), current_date)) > 0
  from academia.fees f where f.id = p_fee
$$;

-- Respetar lo ya pagado: hermanos que ya pagaron su recargo ese mes
update academia.fees f set own_late_fee = true
  from academia.fee_balances fb
 where fb.id = f.id and f.concept = 'Mensualidad' and fb.late_fee > 0 and fb.balance <= 0
   and exists (select 1 from academia.students s where s.id = f.student_id and s.sibling_group_id is not null);

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
left join academia.students s on s.id = f.student_id
cross join lateral (
  select case
    when f.review is not null then 0
    -- Promo de hermanos: si un hermano anterior ya lleva el recargo de ese mes, éste no
    when f.concept = 'Mensualidad' and s.sibling_group_id is not null and not f.own_late_fee and exists (
      select 1 from academia.fees g join academia.students t on t.id = g.student_id
       where g.id <> f.id and g.concept = 'Mensualidad' and g.period = f.period
         and t.sibling_group_id = s.sibling_group_id and t.status <> 'baja'
         and (coalesce(t.sibling_order, 99), t.id::text) < (coalesce(s.sibling_order, 99), s.id::text)
         and academia.fee_is_late(g.id)) then 0
    else academia.late_months(f.due_date, coalesce(
      (select min(c.paid_at) from cum c where c.fee_id = f.id and c.running >= f.amount - f.discount),
      current_date))
  end as late_months
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
grant execute on function academia.fee_settled_on(uuid, numeric), academia.fee_is_late(uuid) to authenticated, anon;
