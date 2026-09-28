-- =====================================================================
-- Portal para padres por LINK PRIVADO (sin registro ni contraseña).
-- Cada alumno tiene un token aleatorio de 256 bits. Quien tenga el link
-- ve SOLO la información deportiva y el estado de cuenta de ese alumno.
-- El link puede revocarse y regenerarse en cualquier momento.
-- =====================================================================

create or replace function public.new_portal_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create table public.portal_links (
  student_id  uuid primary key references public.students (id) on delete cascade,
  token       text not null unique default public.new_portal_token(),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

alter table public.portal_links enable row level security;

create policy portal_links_select on public.portal_links for select to authenticated
  using (public.is_admin() or public.coach_has_student(student_id));
create policy portal_links_write on public.portal_links for all to authenticated
  using (public.is_admin() or public.coach_has_student(student_id))
  with check (public.is_admin() or public.coach_has_student(student_id));

-- Cada alumno nuevo recibe su link automáticamente.
create or replace function public.create_portal_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.portal_links (student_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger students_portal_link after insert on public.students
  for each row execute function public.create_portal_link();

-- Regenerar (revoca el link anterior).
create or replace function public.regenerate_portal_link(p_student uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not (public.is_admin() or public.coach_has_student(p_student)) then
    raise exception 'Sin permiso';
  end if;
  insert into public.portal_links (student_id, token) values (p_student, public.new_portal_token())
  on conflict (student_id) do update set token = excluded.token, created_at = now(), last_seen = null
  returning token into t;
  return t;
end $$;

-- Lectura del portal: única puerta de entrada para visitantes sin sesión.
-- No expone datos médicos, teléfonos ni información de otros alumnos.
create or replace function public.get_portal(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  sid uuid;
  s record;
  result jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select pl.student_id into sid from public.portal_links pl where pl.token = p_token;
  if sid is null then
    return null;
  end if;

  select st.*, c.name as category_name, c.schedule as category_schedule, pr.full_name as coach_name
    into s
    from public.students st
    left join public.categories c on c.id = st.category_id
    left join public.profiles pr on pr.id = st.coach_id
   where st.id = sid;

  if s.status = 'baja' then
    return null;
  end if;

  update public.portal_links set last_seen = now() where student_id = sid;

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'birth_date', s.birth_date,
      'category_id', s.category_id, 'category', s.category_name, 'schedule', s.category_schedule,
      'coach', coalesce(s.coach_name, (
        select string_agg(p.full_name, ', ') from public.coach_categories cc
        join public.profiles p on p.id = cc.coach_id where cc.category_id = s.category_id)),
      'enrolled_at', s.enrolled_at, 'status', s.status, 'has_photo', s.photo_path is not null
    ),
    'academy', (select jsonb_build_object('name', academy_name, 'payment_instructions', payment_instructions)
                from public.settings where id = 1),
    'upcoming_trainings', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.date, 'start_time', t.start_time, 'end_time', t.end_time,
                                          'objectives', t.objectives) order by t.date, t.start_time)
      from (select * from public.trainings where category_id = s.category_id and date >= current_date
            order by date, start_time limit 10) t), '[]'::jsonb),
    'upcoming_matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', m.date, 'time', m.time, 'opponent', m.opponent,
                                          'venue', m.venue, 'is_home', m.is_home) order by m.date, m.time)
      from (select * from public.matches where category_id = s.category_id and date >= current_date
            and status = 'programado' order by date, time limit 10) m), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.date, 'status', a.status) order by t.date desc)
      from public.attendance a join public.trainings t on t.id = a.training_id
      where a.student_id = sid and t.date >= current_date - 365), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', fb.id, 'concept', fb.concept, 'period', fb.period,
             'amount', fb.amount, 'paid', fb.paid, 'balance', fb.balance, 'due_date', fb.due_date,
             'status', fb.status) order by fb.period desc)
      from public.fee_balances fb where fb.student_id = sid), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
             'concept', f.concept, 'period', f.period) order by p.paid_at desc)
      from public.payments p join public.fees f on f.id = p.fee_id where p.student_id = sid), '[]'::jsonb),
    'evaluations', coalesce((
      select jsonb_agg(to_jsonb(e) - 'student_id' - 'coach_id' - 'created_at'
                       || jsonb_build_object('coach', pr.full_name) order by e.date)
      from public.evaluations e left join public.profiles pr on pr.id = e.coach_id
      where e.student_id = sid), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', m.date, 'opponent', m.opponent, 'goals_for', m.goals_for,
             'goals_against', m.goals_against, 'status', m.status, 'starter', mp.starter,
             'position', mp.position, 'goals', mp.goals, 'assists', mp.assists, 'minutes', mp.minutes)
             order by m.date desc)
      from public.match_players mp join public.matches m on m.id = mp.match_id
      where mp.student_id = sid), '[]'::jsonb),
    'trainings_count', (select count(*) from public.trainings t
                        where t.category_id = s.category_id and t.date >= current_date - 365 and t.date <= current_date)
  ) into result;

  return result;
end $$;

revoke all on function public.get_portal(text) from public;
grant execute on function public.get_portal(text) to anon, authenticated;
grant select, insert, update, delete on public.portal_links to authenticated;
revoke all on public.portal_links from anon;
