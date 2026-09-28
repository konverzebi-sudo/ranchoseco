-- =====================================================================
-- Portal para padres por LINK PRIVADO (sin registro ni contraseña).
-- Cada alumno tiene un token aleatorio de 256 bits. Quien tenga el link
-- ve SOLO la información deportiva y el estado de cuenta de ese alumno.
-- El link puede revocarse y regenerarse en cualquier momento.
-- =====================================================================

create or replace function academia.new_portal_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create table academia.portal_links (
  student_id  uuid primary key references academia.students (id) on delete cascade,
  token       text not null unique default academia.new_portal_token(),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

alter table academia.portal_links enable row level security;

create policy portal_links_select on academia.portal_links for select to authenticated
  using (academia.is_admin() or academia.coach_has_student(student_id));
create policy portal_links_write on academia.portal_links for all to authenticated
  using (academia.is_admin() or academia.coach_has_student(student_id))
  with check (academia.is_admin() or academia.coach_has_student(student_id));

-- Cada alumno nuevo recibe su link automáticamente.
create or replace function academia.create_portal_link()
returns trigger language plpgsql security definer set search_path = academia, public as $$
begin
  insert into academia.portal_links (student_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger students_portal_link after insert on academia.students
  for each row execute function academia.create_portal_link();

-- Regenerar (revoca el link anterior).
create or replace function academia.regenerate_portal_link(p_student uuid)
returns text language plpgsql security definer set search_path = academia, public as $$
declare t text;
begin
  if not (academia.is_admin() or academia.coach_has_student(p_student)) then
    raise exception 'Sin permiso';
  end if;
  insert into academia.portal_links (student_id, token) values (p_student, academia.new_portal_token())
  on conflict (student_id) do update set token = excluded.token, created_at = now(), last_seen = null
  returning token into t;
  return t;
end $$;

-- Lectura del portal: única puerta de entrada para visitantes sin sesión.
-- No expone datos médicos, teléfonos ni información de otros alumnos.
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
    left join academia.profiles pr on pr.id = st.coach_id
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
        join academia.profiles p on p.id = cc.coach_id where cc.category_id = s.category_id)),
      'enrolled_at', s.enrolled_at, 'status', s.status, 'has_photo', s.photo_path is not null
    ),
    'academy', (select jsonb_build_object('name', academy_name, 'payment_instructions', payment_instructions)
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
      select jsonb_agg(jsonb_build_object('date', t.date, 'status', a.status) order by t.date desc)
      from academia.attendance a join academia.trainings t on t.id = a.training_id
      where a.student_id = sid and t.date >= current_date - 365), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', fb.id, 'concept', fb.concept, 'period', fb.period,
             'amount', fb.amount, 'paid', fb.paid, 'balance', fb.balance, 'due_date', fb.due_date,
             'status', fb.status) order by fb.period desc)
      from academia.fee_balances fb where fb.student_id = sid), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
             'concept', f.concept, 'period', f.period) order by p.paid_at desc)
      from academia.payments p join academia.fees f on f.id = p.fee_id where p.student_id = sid), '[]'::jsonb),
    'evaluations', coalesce((
      select jsonb_agg(to_jsonb(e) - 'student_id' - 'coach_id' - 'created_at'
                       || jsonb_build_object('coach', pr.full_name) order by e.date)
      from academia.evaluations e left join academia.profiles pr on pr.id = e.coach_id
      where e.student_id = sid), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', m.date, 'opponent', m.opponent, 'goals_for', m.goals_for,
             'goals_against', m.goals_against, 'status', m.status, 'starter', mp.starter,
             'position', mp.position, 'goals', mp.goals, 'assists', mp.assists, 'minutes', mp.minutes)
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
grant select, insert, update, delete on academia.portal_links to authenticated;
revoke all on academia.portal_links from anon;
