-- =====================================================================
-- 1) RECARGOS: se paga hasta el día 8; desde el 9 un recargo de $50.
--    El recargo NO es acumulable: un solo recargo por cada mes atrasado
--    (septiembre atrasado = $50 aunque pase octubre; octubre trae su propio $50).
--    - Las mensualidades que todavía se deben pasan a vencer el día 8.
--    - Nuevo ingreso: 15 días de tolerancia para liquidar su primera mensualidad.
--    - Quien ya pagó más de un recargo: se respeta lo que pagó (no queda de más).
-- 2) SEGURO: quién está dado de alta, y altas / bajas de cada mes.
-- 3) GASTOS: de dónde salió el dinero (caja del mes, caja de ahorro…).
-- =====================================================================

-- 1) Recargos ---------------------------------------------------------
alter table academia.fees disable trigger act_fees;

update academia.fees f set due_date = f.due_date + 3
  from academia.fee_balances fb
 where fb.id = f.id and fb.balance > 0 and f.concept = 'Mensualidad' and extract(day from f.due_date) = 5;

update academia.fees f set due_date = s.enrolled_at + 15
  from academia.students s, academia.fee_balances fb
 where s.id = f.student_id and fb.id = f.id and fb.balance > 0 and f.concept = 'Mensualidad'
   and date_trunc('month', s.enrolled_at)::date = f.period and s.enrolled_at <> date '2026-09-01'
   and f.due_date < s.enrolled_at + 15;

create or replace function academia.late_months(due date, settled date)
returns int language sql immutable as $$
  select case when settled <= due then 0 else 1 end
$$;

update academia.fees f set late_fee_amount = f.late_fee_amount - fb.balance
  from academia.fee_balances fb
 where fb.id = f.id and fb.balance < 0 and fb.late_months > 0;

alter table academia.fees enable trigger act_fees;

select academia.act_log('cargo', 'Nueva regla de recargos',
  'Se paga hasta el día 8; desde el 9 un recargo de $50 por mes atrasado (no acumulable). Nuevo ingreso: 15 días de tolerancia.', '/cobranza', null);

-- 2) Seguro -----------------------------------------------------------
alter table academia.students
  add column if not exists insured boolean not null default false,
  add column if not exists insured_on date;

create table if not exists academia.insurance_movements (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references academia.students (id) on delete cascade,
  kind        text not null check (kind in ('alta', 'baja')),
  on_date     date not null default current_date,
  actor       text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists insurance_movements_date_idx on academia.insurance_movements (on_date desc);
alter table academia.insurance_movements enable row level security;
drop policy if exists insurance_movements_admin on academia.insurance_movements;
create policy insurance_movements_admin on academia.insurance_movements for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists insurance_movements_open_mode on academia.insurance_movements;
create policy insurance_movements_open_mode on academia.insurance_movements for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.insurance_movements to authenticated, anon;

create or replace function academia.trg_act_insurance() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  perform academia.act_log('alumno', 'Seguro: ' || case new.kind when 'alta' then 'alta de ' else 'baja de ' end || academia.act_student(new.student_id),
    academia.act_fecha(new.on_date) || coalesce(' · ' || new.note, ''), '/seguro', new.student_id);
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_insurance on academia.insurance_movements;
create trigger act_insurance after insert on academia.insurance_movements for each row execute function academia.trg_act_insurance();

-- 3) De dónde salió el gasto -------------------------------------------
alter table academia.expenses add column if not exists paid_from text not null default 'caja'
  check (paid_from in ('caja', 'ahorro', 'apartado', 'uniformes', 'otro'));
