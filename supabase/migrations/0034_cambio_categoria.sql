-- =====================================================================
-- SOLICITUDES DE CAMBIO DE CATEGORÍA
-- Un profe solicita el cambio desde el perfil del alumno; lo aprueba el
-- coordinador (Prof. Padrón) o administración. Si lo hacen ellos, es directo.
-- =====================================================================
create table if not exists academia.category_change_requests (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references academia.students (id) on delete cascade,
  from_category  uuid references academia.categories (id) on delete set null,
  to_category    uuid not null references academia.categories (id) on delete cascade,
  reason         text,
  requested_by   text,
  status         text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);
create index if not exists category_change_requests_pending_idx on academia.category_change_requests (created_at desc) where status = 'pendiente';
alter table academia.category_change_requests enable row level security;
drop policy if exists category_change_requests_admin on academia.category_change_requests;
create policy category_change_requests_admin on academia.category_change_requests for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists category_change_requests_open_mode on academia.category_change_requests;
create policy category_change_requests_open_mode on academia.category_change_requests for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.category_change_requests to authenticated, anon;

-- Bitácora
create or replace function academia.trg_act_category_requests() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('alumno', 'Solicitud de cambio de categoría: ' || academia.act_student(new.student_id),
      academia.act_cat(new.from_category) || ' → ' || academia.act_cat(new.to_category) || coalesce(' · ' || new.reason, '') || coalesce(' · solicitó ' || new.requested_by, ''),
      '/alumnos/' || new.student_id, new.student_id);
  elsif new.status is distinct from old.status and new.status <> 'pendiente' then
    perform academia.act_log('alumno', 'Cambio de categoría ' || new.status || ': ' || academia.act_student(new.student_id),
      academia.act_cat(new.from_category) || ' → ' || academia.act_cat(new.to_category) || coalesce(' · ' || new.decided_by, ''),
      '/alumnos/' || new.student_id, new.student_id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_category_requests on academia.category_change_requests;
create trigger act_category_requests after insert or update on academia.category_change_requests for each row execute function academia.trg_act_category_requests();
