-- =====================================================================
-- MODO ABIERTO (temporal)
-- Mientras academia.settings.open_mode = true, el sitio funciona sin
-- usuario ni contraseña: cualquier visitante del sitio puede consultar y
-- editar la información. Para cerrarlo y exigir acceso por rol:
--
--   update academia.settings set open_mode = false;
--
-- Con open_mode = false quedan activas sólo las políticas por rol
-- (admin / profesor / padre) y el portal por link privado.
-- =====================================================================

alter table academia.settings add column open_mode boolean not null default true;

create or replace function academia.open_mode()
returns boolean language sql stable security definer set search_path = academia, public as $$
  select coalesce((select open_mode from academia.settings where id = 1), false)
$$;
grant execute on function academia.open_mode() to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'settings','categories','coaches','coach_categories','guardians','students','student_guardians',
    'student_medical','enrollments','fees','payments','trainings','attendance','matches',
    'match_players','evaluations','reports','portal_links'
  ] loop
    execute format('grant select, insert, update, delete on academia.%I to anon', t);
    execute format(
      'create policy %I on academia.%I for all to anon using (academia.open_mode()) with check (academia.open_mode())',
      t || '_open_mode', t);
  end loop;
end $$;

-- En modo abierto nadie puede apagar/encender el interruptor desde el sitio:
-- sólo desde el SQL Editor de Supabase.
create or replace function academia.protect_open_mode()
returns trigger language plpgsql as $$
begin
  if new.open_mode is distinct from old.open_mode and current_user in ('anon', 'authenticated') then
    raise exception 'El modo abierto sólo se cambia desde el panel de Supabase';
  end if;
  return new;
end $$;
create trigger settings_protect_open_mode before update on academia.settings
  for each row execute function academia.protect_open_mode();

grant select on academia.fee_balances, academia.student_accounts, academia.attendance_detail to anon;
grant execute on function academia.regenerate_portal_link(uuid) to anon;

-- regenerate_portal_link también debe funcionar en modo abierto
create or replace function academia.regenerate_portal_link(p_student uuid)
returns text language plpgsql security definer set search_path = academia, public as $$
declare t text;
begin
  if not (academia.open_mode() or academia.is_admin() or academia.coach_has_student(p_student)) then
    raise exception 'Sin permiso';
  end if;
  insert into academia.portal_links (student_id, token) values (p_student, academia.new_portal_token())
  on conflict (student_id) do update set token = excluded.token, created_at = now(), last_seen = null
  returning token into t;
  return t;
end $$;
