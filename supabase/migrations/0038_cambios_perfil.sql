-- =====================================================================
-- SOLICITUDES DE CAMBIO EN EL PERFIL DEL ALUMNO
-- Un profe edita el perfil (p. ej. desde Evaluaciones); el cambio queda
-- pendiente y lo confirma administración. Si lo hace administración, es directo.
-- changes = { campo: { "from": valor anterior, "to": valor nuevo } }
-- =====================================================================
create table if not exists academia.student_edit_requests (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references academia.students (id) on delete cascade,
  changes        jsonb not null,
  requested_by   text,
  status         text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists student_edit_requests_pending_idx on academia.student_edit_requests (created_at desc) where status = 'pendiente';
alter table academia.student_edit_requests enable row level security;
drop policy if exists student_edit_requests_admin on academia.student_edit_requests;
create policy student_edit_requests_admin on academia.student_edit_requests for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists student_edit_requests_open_mode on academia.student_edit_requests;
create policy student_edit_requests_open_mode on academia.student_edit_requests for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.student_edit_requests to authenticated, anon;

-- Bitácora
create or replace function academia.trg_act_student_edit_requests() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('alumno', 'Solicitud de cambio de perfil: ' || academia.act_student(new.student_id),
      (select string_agg(k, ', ') from jsonb_object_keys(new.changes) k) || coalesce(' · solicitó ' || new.requested_by, ''),
      '/alumnos/' || new.student_id, new.student_id);
  elsif new.status is distinct from old.status and new.status <> 'pendiente' then
    perform academia.act_log('alumno', 'Cambio de perfil ' || new.status || ': ' || academia.act_student(new.student_id),
      coalesce(new.decided_by, ''), '/alumnos/' || new.student_id, new.student_id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_student_edit_requests on academia.student_edit_requests;
create trigger act_student_edit_requests after insert or update on academia.student_edit_requests for each row execute function academia.trg_act_student_edit_requests();

notify pgrst, 'reload schema';
