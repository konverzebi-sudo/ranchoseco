-- =====================================================================
-- ENTREGAS DE UNIFORME, PLAYERA Y CREDENCIAL
-- Cada entrega queda registrada: cuándo, quién la entregó y cómo quedó el pago:
--   pagado  = ya estaba pagado (o se pagó al entregar)
--   adeudo  = se entregó sin pagar: queda un cargo pendiente (sale en el Dashboard)
--   previo  = se pagó antes de usar esta plataforma (sólo octubre 2026; no mueve dinero)
-- Las columnas students.*_delivered_on siguen guardando la fecha de entrega.
-- =====================================================================
create table if not exists academia.deliveries (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references academia.students (id) on delete cascade,
  item          text not null check (item in ('uniforme', 'playera', 'credencial')),
  delivered_on  date not null default current_date,
  delivered_by  text,
  payment       text not null check (payment in ('pagado', 'adeudo', 'previo')),
  fee_id        uuid references academia.fees (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists deliveries_student_idx on academia.deliveries (student_id);
alter table academia.deliveries enable row level security;
drop policy if exists deliveries_admin on academia.deliveries;
create policy deliveries_admin on academia.deliveries for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists deliveries_open_mode on academia.deliveries;
create policy deliveries_open_mode on academia.deliveries for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.deliveries to authenticated, anon;

-- Bitácora
create or replace function academia.trg_act_deliveries() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare r academia.deliveries;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' then return null; end if;
  perform academia.act_log('alumno',
    case when tg_op = 'INSERT' then 'Se entregó ' else 'Se quitó la entrega de ' end
      || case r.item when 'uniforme' then 'el uniforme' when 'playera' then 'la playera de entrenamiento' else 'la credencial' end
      || ' a ' || academia.act_student(r.student_id),
    case when tg_op = 'INSERT' then concat_ws(' · ',
      case r.payment when 'pagado' then 'Ya pagado' when 'adeudo' then 'SIN PAGAR: queda como adeudo' else 'Pagado antes de la plataforma' end,
      'Entregó: ' || r.delivered_by, r.notes) end,
    '/alumnos/' || r.student_id, r.student_id);
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_deliveries on academia.deliveries;
create trigger act_deliveries after insert or delete on academia.deliveries for each row execute function academia.trg_act_deliveries();
