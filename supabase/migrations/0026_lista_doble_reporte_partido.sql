-- =====================================================================
-- LISTA DOBLE, NOTAS DEL PROFE Y REPORTE DEL PARTIDO
-- - attendance (lista del profe) sigue siendo la lista oficial.
-- - attendance_checks: la lista que lleva administración para verificar.
--   Si no coincide, administración ve una alerta; al profe no se le dice nada.
-- - trainings.verified_at/by: administración confirma que la lista es correcta.
-- - trainings.coach_notes: nota del profe para el grupo; attendance.notes: nota por niño.
-- - matches.report: reporte al terminar el partido (marcador, lesionados, comportamiento).
-- - match_players.injured: se lesionó en el partido.
-- - get_portal: el reporte del mes para los papás (sin calificaciones).
-- =====================================================================
create table if not exists academia.attendance_checks (
  training_id  uuid not null references academia.trainings (id) on delete cascade,
  student_id   uuid not null references academia.students (id) on delete cascade,
  status       academia.attendance_status not null,
  actor        text,
  updated_at   timestamptz not null default now(),
  primary key (training_id, student_id)
);
alter table academia.attendance_checks enable row level security;
drop policy if exists attendance_checks_admin on academia.attendance_checks;
create policy attendance_checks_admin on academia.attendance_checks for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists attendance_checks_open_mode on academia.attendance_checks;
create policy attendance_checks_open_mode on academia.attendance_checks for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.attendance_checks to authenticated, anon;

alter table academia.trainings
  add column if not exists coach_notes text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text;

alter table academia.matches
  add column if not exists report jsonb,
  add column if not exists report_at timestamptz;

alter table academia.match_players add column if not exists injured boolean not null default false;

-- Bitácora: lista de administración, confirmación y notas
create or replace function academia.trg_act_attendance_checks() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare tid uuid := case when tg_op = 'DELETE' then old.training_id else new.training_id end; t record; n int; dif int;
begin
  select * into t from academia.trainings where id = tid;
  if not found then return null; end if;
  select count(*), count(*) filter (where a.status is distinct from c.status) into n, dif
    from academia.attendance_checks c left join academia.attendance a on a.training_id = c.training_id and a.student_id = c.student_id
   where c.training_id = tid;
  perform academia.act_merge('verif:' || tid, 'lista', 'Administración pasó lista: ' || academia.act_cat(t.category_id) || ' · ' || academia.act_fecha(t.date),
    n || ' niños' || case when dif > 0 then ' · ' || dif || ' no coinciden con la lista del profe' else ' · coincide con el profe' end, '/asistencias', null);
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_attendance_checks on academia.attendance_checks;
create trigger act_attendance_checks after insert or update or delete on academia.attendance_checks for each row execute function academia.trg_act_attendance_checks();

create or replace function academia.trg_act_trainings_extra() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if old.verified_at is null and new.verified_at is not null then
    perform academia.act_log('lista', 'Lista confirmada: ' || academia.act_cat(new.category_id) || ' · ' || academia.act_fecha(new.date), 'Confirmó: ' || coalesce(new.verified_by, '—'), '/asistencias', null);
  end if;
  if new.coach_notes is distinct from old.coach_notes and coalesce(new.coach_notes, '') <> '' then
    perform academia.act_merge('nota-entreno:' || new.id, 'lista', 'Nota del profe: ' || academia.act_cat(new.category_id) || ' · ' || academia.act_fecha(new.date), left(new.coach_notes, 300), '/asistencias', null);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_trainings_extra on academia.trainings;
create trigger act_trainings_extra after update on academia.trainings for each row execute function academia.trg_act_trainings_extra();

create or replace function academia.trg_act_match_report() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if new.report is distinct from old.report and new.report is not null then
    perform academia.act_merge('reporte-partido:' || new.id, 'partido', 'Reporte del partido: ' || academia.act_cat(new.category_id) || ' vs ' || new.opponent,
      concat_ws(' · ', case when new.goals_for is not null then 'Quedó ' || new.goals_for || '-' || new.goals_against end,
        case when coalesce(new.report ->> 'injuries', '') <> '' then 'Lesionados: ' || (new.report ->> 'injuries') end,
        nullif(left(concat_ws(' · ', new.report ->> 'kids', new.report ->> 'parents', new.report ->> 'referees', new.report ->> 'tournament', new.report ->> 'other'), 300), '')),
      '/partidos/' || new.id, null);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists act_match_report on academia.matches;
create trigger act_match_report after update on academia.matches for each row execute function academia.trg_act_match_report();

-- ---------------------------------------------------------------------
-- Link de los papás: se agregan notas del profe por niño y si asistió al partido
-- ---------------------------------------------------------------------
create or replace function academia.get_portal(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = academia, public as $$
declare
  sid uuid;
  s record;
  result jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select pl.student_id into sid from academia.portal_links pl where pl.token = p_token;
  if sid is null then
    return null;
  end if;

  select st.*, c.name as category_name, c.schedule as category_schedule, pr.full_name as coach_name
    into s
    from academia.students st
    left join academia.categories c on c.id = st.category_id
    left join academia.coaches pr on pr.id = st.coach_id
   where st.id = sid;

  if s.status = 'baja' then
    return null;
  end if;

  update academia.portal_links set last_seen = now() where student_id = sid;

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'birth_date', s.birth_date,
      'category_id', s.category_id, 'category', s.category_name, 'schedule', s.category_schedule,
      'coach', coalesce(s.coach_name, (
        select string_agg(p.full_name, ', ') from academia.coach_categories cc
        join academia.coaches p on p.id = cc.coach_id where cc.category_id = s.category_id and p.active)),
      'enrolled_at', s.enrolled_at, 'status', s.status, 'has_photo', s.photo_path is not null
    ),
    'academy', (select jsonb_build_object('name', academy_name, 'payment_instructions', payment_instructions,
                'due_day', due_day, 'late_fee_amount', late_fee_amount)
                from academia.settings where id = 1),
    'upcoming_trainings', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.date, 'start_time', t.start_time, 'end_time', t.end_time,
                                          'objectives', t.objectives) order by t.date, t.start_time)
      from (select * from academia.trainings where category_id = s.category_id and date >= current_date
            order by date, start_time limit 10) t), '[]'::jsonb),
    'upcoming_matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', m.date, 'time', m.time, 'opponent', m.opponent,
                                          'venue', m.venue, 'is_home', m.is_home) order by m.date, m.time)
      from (select * from academia.matches where category_id = s.category_id and date >= current_date
            and status = 'programado' order by date, time limit 10) m), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.date, 'status', a.status, 'note', a.notes) order by t.date desc)
      from academia.attendance a join academia.trainings t on t.id = a.training_id
      where a.student_id = sid and t.date >= current_date - 365), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', fb.id, 'concept', fb.concept, 'period', fb.period,
             'amount', fb.amount, 'paid', fb.paid, 'balance', fb.balance, 'due_date', fb.due_date,
             'status', fb.status, 'late_fee', fb.late_fee, 'late_months', fb.late_months,
             'total_due', fb.total_due, 'discount', fb.discount, 'discount_reason', fb.discount_reason)
             order by fb.period desc)
      from academia.fee_balances fb where fb.student_id = sid), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
             'concept', f.concept, 'period', f.period) order by p.paid_at desc)
      from academia.payments p join academia.fees f on f.id = p.fee_id where p.student_id = sid), '[]'::jsonb),
    'evaluations', coalesce((
      select jsonb_agg(to_jsonb(e) - 'student_id' - 'coach_id' - 'created_at'
                       || jsonb_build_object('coach', pr.full_name) order by e.date)
      from academia.evaluations e left join academia.coaches pr on pr.id = e.coach_id
      where e.student_id = sid), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', m.date, 'opponent', m.opponent, 'goals_for', m.goals_for,
             'goals_against', m.goals_against, 'status', m.status, 'starter', mp.starter,
             'position', mp.position, 'goals', mp.goals, 'assists', mp.assists, 'minutes', mp.minutes,
             'attended', mp.attended, 'note', mp.notes)
             order by m.date desc)
      from academia.match_players mp join academia.matches m on m.id = mp.match_id
      where mp.student_id = sid), '[]'::jsonb),
    'trainings_count', (select count(*) from academia.trainings t
                        where t.category_id = s.category_id and t.date >= current_date - 365 and t.date <= current_date)
  ) into result;

  return result;
end $$;

revoke all on function academia.get_portal(text) from public;
grant execute on function academia.get_portal(text) to anon, authenticated;
