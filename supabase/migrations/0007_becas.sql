-- =====================================================================
-- BECAS Y MONTOS POR CONFIRMAR
-- - Cada cargo guarda el precio normal (amount) y, si aplica, un descuento
--   (discount) con su motivo (p. ej. "Beca"). Así se sabe cuánto se beca.
-- - Un alumno puede tener una cuota especial (students.monthly_fee) que se
--   usa al generar las mensualidades siguientes.
-- - Un cargo puede quedar "por confirmar" (review) cuando se pagó menos de lo
--   normal y no se sabe si es beca o adeudo. Mientras esté por confirmar no
--   corre recargo y no se marca como vencido.
-- =====================================================================

alter table academia.students
  add column monthly_fee numeric(10,2) check (monthly_fee is null or monthly_fee >= 0);

alter table academia.fees
  add column discount        numeric(10,2) not null default 0 check (discount >= 0),
  add column discount_reason text,
  add column review          text check (review is null or review in ('confirmar_beca'));

alter table academia.fees add constraint fees_discount_le_amount check (discount <= amount);

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
  f.late_fee_per_day, f.late_fee_waived,
  d.late_days,
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
  select case when f.review is not null then 0 else greatest(0, coalesce(
    (select min(c.paid_at) from cum c where c.fee_id = f.id and c.running >= f.amount - f.discount),
    current_date) - f.due_date) end::int as late_days
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
