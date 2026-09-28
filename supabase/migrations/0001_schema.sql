-- =====================================================================
-- RANCHO SECO | CONTROL DE ACADEMIA — Esquema base
-- Postgres / Supabase. Toda la seguridad se aplica con Row Level Security.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'profesor', 'padre');
create type public.student_status as enum ('activo', 'suspendido', 'baja');
create type public.attendance_status as enum ('presente', 'falta', 'justificada', 'retardo');
create type public.payment_method as enum ('efectivo', 'transferencia', 'tarjeta', 'deposito', 'otro');
create type public.match_status as enum ('programado', 'jugado', 'cancelado');

-- ---------------------------------------------------------------------
-- Usuarios y roles
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  phone       text,
  role        public.app_role not null default 'padre',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configuración general (una sola fila)
-- ---------------------------------------------------------------------
create table public.settings (
  id                   smallint primary key default 1 check (id = 1),
  academy_name         text not null default 'Deportivo Rancho Seco',
  default_country_code text not null default '52',
  default_monthly_fee  numeric(10,2) not null default 0,
  due_day              smallint not null default 10 check (due_day between 1 and 28),
  payment_instructions text not null default '',
  collection_template  text not null default
    'Hola, buen día. Te contactamos de Deportivo Rancho Seco para recordarte que se encuentra pendiente el pago de la mensualidad de [MES] de [NOMBRE DEL ALUMNO], por un saldo de $[SALDO] MXN.' || chr(10) || chr(10) ||
    'Cuando realices tu pago, puedes compartirnos tu comprobante por este medio.' || chr(10) || chr(10) ||
    '¡Muchas gracias por formar parte de nuestra familia Rancho Seco!',
  report_template      text not null default
    'Hola, te compartimos el reporte deportivo de [NOMBRE DEL ALUMNO], correspondiente al periodo [PERIODO].' || chr(10) || chr(10) ||
    'En este documento podrás consultar sus asistencias, participación en entrenamientos y partidos, así como sus avances y objetivos deportivos.' || chr(10) || chr(10) ||
    '¡Gracias por confiar en Deportivo Rancho Seco!',
  updated_at           timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------
-- Categorías y profesores asignados
-- ---------------------------------------------------------------------
create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  schedule     text,
  monthly_fee  numeric(10,2),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.coach_categories (
  coach_id     uuid not null references public.profiles (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  primary key (coach_id, category_id)
);

-- ---------------------------------------------------------------------
-- Tutores y alumnos
-- ---------------------------------------------------------------------
create table public.guardians (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text not null check (phone ~ '^[0-9]{10,15}$'),  -- internacional, sólo dígitos (ej. 5215512345678)
  email         text,
  relationship  text,
  user_id       uuid unique references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.students (
  id                       uuid primary key default gen_random_uuid(),
  full_name                text not null,
  photo_path               text,
  birth_date               date,
  category_id              uuid references public.categories (id) on delete set null,
  coach_id                 uuid references public.profiles (id) on delete set null,
  enrolled_at              date not null default current_date,
  status                   public.student_status not null default 'activo',
  emergency_contact_name   text,
  emergency_contact_phone  text,
  notes                    text,
  created_at               timestamptz not null default now()
);
create index students_category_idx on public.students (category_id);
create index students_name_idx on public.students (lower(full_name));

create table public.student_guardians (
  student_id   uuid not null references public.students (id) on delete cascade,
  guardian_id  uuid not null references public.guardians (id) on delete cascade,
  is_primary   boolean not null default true,
  primary key (student_id, guardian_id)
);

-- Información médica: tabla aparte para restringir su acceso.
create table public.student_medical (
  student_id   uuid primary key references public.students (id) on delete cascade,
  blood_type   text,
  allergies    text,
  conditions   text,
  medications  text,
  insurance    text,
  notes        text,
  updated_at   timestamptz not null default now()
);

-- Historial de inscripciones por categoría (lo llena un trigger).
create table public.enrollments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  start_date   date not null default current_date,
  end_date     date,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Mensualidades y pagos
-- ---------------------------------------------------------------------
create table public.fees (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  concept     text not null default 'Mensualidad',
  period      date not null,               -- primer día del mes que cubre
  amount      numeric(10,2) not null check (amount > 0),
  due_date    date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (student_id, concept, period)
);
create index fees_student_idx on public.fees (student_id);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  fee_id        uuid not null references public.fees (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  amount        numeric(10,2) not null check (amount > 0),
  paid_at       date not null default current_date,
  method        public.payment_method not null default 'efectivo',
  receipt_path  text,
  notes         text,
  recorded_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index payments_fee_idx on public.payments (fee_id);

-- ---------------------------------------------------------------------
-- Entrenamientos, asistencias y partidos
-- ---------------------------------------------------------------------
create table public.trainings (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories (id) on delete cascade,
  coach_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  date         date not null,
  start_time   time,
  end_time     time,
  objectives   text,
  exercises    text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index trainings_cat_date_idx on public.trainings (category_id, date);

create table public.attendance (
  id           uuid primary key default gen_random_uuid(),
  training_id  uuid not null references public.trainings (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  status       public.attendance_status not null,
  notes        text,
  recorded_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (training_id, student_id)
);
create index attendance_student_idx on public.attendance (student_id);

create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.categories (id) on delete cascade,
  opponent       text not null,
  date           date not null,
  time           time,
  venue          text,
  is_home        boolean not null default true,
  goals_for      smallint check (goals_for >= 0),
  goals_against  smallint check (goals_against >= 0),
  status         public.match_status not null default 'programado',
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index matches_cat_date_idx on public.matches (category_id, date);

-- Convocatoria, alineación y estadísticas individuales.
create table public.match_players (
  match_id    uuid not null references public.matches (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  starter     boolean not null default false,
  position    text,
  goals       smallint not null default 0 check (goals >= 0),
  assists     smallint not null default 0 check (assists >= 0),
  minutes     smallint not null default 0 check (minutes between 0 and 200),
  notes       text,
  primary key (match_id, student_id)
);

-- ---------------------------------------------------------------------
-- Seguimiento deportivo
-- ---------------------------------------------------------------------
create table public.evaluations (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id) on delete cascade,
  coach_id         uuid references public.profiles (id) on delete set null default auth.uid(),
  date             date not null default current_date,
  -- Técnica
  pase             smallint not null check (pase between 1 and 5),
  control_balon    smallint not null check (control_balon between 1 and 5),
  conduccion       smallint not null check (conduccion between 1 and 5),
  tiro             smallint not null check (tiro between 1 and 5),
  recepcion        smallint not null check (recepcion between 1 and 5),
  -- Física
  velocidad        smallint not null check (velocidad between 1 and 5),
  resistencia      smallint not null check (resistencia between 1 and 5),
  coordinacion     smallint not null check (coordinacion between 1 and 5),
  agilidad         smallint not null check (agilidad between 1 and 5),
  -- Táctica
  posicionamiento  smallint not null check (posicionamiento between 1 and 5),
  toma_decisiones  smallint not null check (toma_decisiones between 1 and 5),
  juego_equipo     smallint not null check (juego_equipo between 1 and 5),
  -- Actitud
  disciplina       smallint not null check (disciplina between 1 and 5),
  esfuerzo         smallint not null check (esfuerzo between 1 and 5),
  companerismo     smallint not null check (companerismo between 1 and 5),
  strengths        text,
  improvements     text,
  goals            text,
  comments         text,
  created_at       timestamptz not null default now()
);
create index evaluations_student_idx on public.evaluations (student_id, date);

-- ---------------------------------------------------------------------
-- Reportes PDF generados
-- ---------------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id) on delete cascade,
  period_from   date not null,
  period_to     date not null,
  file_path     text,
  generated_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index reports_student_idx on public.reports (student_id);

-- =====================================================================
-- Funciones auxiliares de autorización (SECURITY DEFINER evita recursión RLS)
-- =====================================================================
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.coach_has_category(cat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.coach_categories cc
    join public.profiles p on p.id = cc.coach_id and p.active and p.role = 'profesor'
    where cc.coach_id = auth.uid() and cc.category_id = cat
  )
$$;

create or replace function public.coach_has_student(stu uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    join public.profiles p on p.id = auth.uid() and p.active and p.role = 'profesor'
    where s.id = stu
      and (s.coach_id = auth.uid()
           or exists (select 1 from public.coach_categories cc
                      where cc.coach_id = auth.uid() and cc.category_id = s.category_id))
  )
$$;

create or replace function public.parent_has_student(stu uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    join public.profiles p on p.id = g.user_id and p.active
    where sg.student_id = stu and g.user_id = auth.uid()
  )
$$;

create or replace function public.parent_has_category(cat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.category_id = cat and public.parent_has_student(s.id)
  )
$$;

create or replace function public.can_see_student(stu uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.coach_has_student(stu) or public.parent_has_student(stu)
$$;

-- =====================================================================
-- Triggers
-- =====================================================================

-- Nuevo usuario de Auth -> perfil. El rol NUNCA se toma de los metadatos
-- del cliente: siempre inicia como 'padre' y sólo un admin puede cambiarlo.
-- Si su correo coincide con un tutor registrado, se vincula automáticamente.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  update public.guardians
     set user_id = new.id
   where user_id is null and email is not null and lower(email) = lower(new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un usuario puede editar su nombre/teléfono, pero no su rol ni su estado.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_admin() and auth.uid() is not null then
    raise exception 'Sólo un administrador puede cambiar roles o estatus';
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Historial de inscripción cuando cambia la categoría del alumno.
create or replace function public.track_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.enrollments (student_id, category_id, start_date)
    values (new.id, new.category_id, new.enrolled_at);
  elsif new.category_id is distinct from old.category_id then
    update public.enrollments set end_date = current_date
     where student_id = new.id and end_date is null;
    insert into public.enrollments (student_id, category_id, start_date)
    values (new.id, new.category_id, current_date);
  end if;
  return new;
end $$;

create trigger students_enrollment after insert or update of category_id on public.students
  for each row execute function public.track_enrollment();

-- Un pago no puede exceder el saldo del cargo y debe pertenecer al mismo alumno.
create or replace function public.validate_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fee_amount numeric; fee_student uuid; paid numeric;
begin
  select amount, student_id into fee_amount, fee_student from public.fees where id = new.fee_id;
  if fee_student is distinct from new.student_id then
    raise exception 'El pago no corresponde al alumno del cargo';
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments
   where fee_id = new.fee_id and id is distinct from new.id;
  if paid + new.amount > fee_amount then
    raise exception 'El pago (%) excede el saldo pendiente (%)', new.amount, fee_amount - paid;
  end if;
  return new;
end $$;

create trigger payments_validate before insert or update on public.payments
  for each row execute function public.validate_payment();

-- Asistencia sólo para alumnos de la categoría del entrenamiento.
create or replace function public.validate_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.trainings t join public.students s on s.category_id = t.category_id
    where t.id = new.training_id and s.id = new.student_id
  ) then
    raise exception 'El alumno no pertenece a la categoría de este entrenamiento';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger attendance_validate before insert or update on public.attendance
  for each row execute function public.validate_attendance();

-- =====================================================================
-- Vistas (security_invoker => respetan el RLS de quien consulta)
-- =====================================================================
create view public.fee_balances with (security_invoker = true) as
select
  f.id, f.student_id, f.concept, f.period, f.amount, f.due_date, f.notes, f.created_at,
  coalesce(p.paid, 0)::numeric(10,2)                 as paid,
  (f.amount - coalesce(p.paid, 0))::numeric(10,2)    as balance,
  p.last_paid_at,
  case
    when coalesce(p.paid, 0) >= f.amount then 'pagado'
    when f.due_date < current_date then 'vencido'
    when coalesce(p.paid, 0) > 0 then 'parcial'
    else 'pendiente'
  end as status
from public.fees f
left join lateral (
  select sum(amount) as paid, max(paid_at) as last_paid_at
  from public.payments where fee_id = f.id
) p on true;

-- Resumen de cuenta por alumno.
create view public.student_accounts with (security_invoker = true) as
select
  s.id as student_id,
  coalesce(sum(fb.balance), 0)::numeric(10,2) as balance,
  coalesce(sum(fb.balance) filter (where fb.status = 'vencido'), 0)::numeric(10,2) as overdue,
  count(*) filter (where fb.status = 'vencido')                 as overdue_count,
  count(*) filter (where fb.status in ('pendiente','parcial'))   as pending_count,
  min(fb.due_date) filter (where fb.balance > 0)                 as next_due,
  case
    when count(*) filter (where fb.status = 'vencido') > 0 then 'vencido'
    when count(*) filter (where fb.status = 'parcial') > 0 then 'parcial'
    when count(*) filter (where fb.status = 'pendiente') > 0 then 'pendiente'
    else 'al_corriente'
  end as status
from public.students s
left join public.fee_balances fb on fb.student_id = s.id
group by s.id;

-- Asistencia con fecha y categoría del entrenamiento.
create view public.attendance_detail with (security_invoker = true) as
select a.id, a.training_id, a.student_id, a.status, a.notes, a.updated_at,
       t.date, t.category_id, t.start_time
from public.attendance a
join public.trainings t on t.id = a.training_id;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.settings          enable row level security;
alter table public.categories        enable row level security;
alter table public.coach_categories  enable row level security;
alter table public.guardians         enable row level security;
alter table public.students          enable row level security;
alter table public.student_guardians enable row level security;
alter table public.student_medical   enable row level security;
alter table public.enrollments       enable row level security;
alter table public.fees              enable row level security;
alter table public.payments          enable row level security;
alter table public.trainings         enable row level security;
alter table public.attendance        enable row level security;
alter table public.matches           enable row level security;
alter table public.match_players     enable row level security;
alter table public.evaluations       enable row level security;
alter table public.reports           enable row level security;

-- profiles: cada quien ve su perfil; todos ven a admins y profesores (nombre del profe);
-- el profesor ve los perfiles de los padres de sus alumnos; admin ve y edita todo.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin() or role in ('admin', 'profesor')
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated using (public.is_admin());

-- settings
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- categories
create policy categories_select on public.categories for select to authenticated using (
  public.is_admin() or public.coach_has_category(id) or public.parent_has_category(id)
);
create policy categories_write on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- coach_categories
create policy coach_categories_select on public.coach_categories for select to authenticated using (
  public.is_admin() or coach_id = auth.uid() or public.parent_has_category(category_id)
);
create policy coach_categories_write on public.coach_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- students
create policy students_select on public.students for select to authenticated using (public.can_see_student(id));
create policy students_write on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- guardians: admin; profesor de alguno de sus hijos; el propio padre.
create policy guardians_select on public.guardians for select to authenticated using (
  public.is_admin() or user_id = auth.uid() or exists (
    select 1 from public.student_guardians sg
    where sg.guardian_id = guardians.id and public.coach_has_student(sg.student_id)
  )
);
create policy guardians_write on public.guardians for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- student_guardians
create policy student_guardians_select on public.student_guardians for select to authenticated
  using (public.can_see_student(student_id));
create policy student_guardians_write on public.student_guardians for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- student_medical: acceso restringido (admin, profesor responsable, padre del alumno)
create policy medical_select on public.student_medical for select to authenticated
  using (public.can_see_student(student_id));
create policy medical_write on public.student_medical for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- enrollments
create policy enrollments_select on public.enrollments for select to authenticated
  using (public.can_see_student(student_id));
create policy enrollments_write on public.enrollments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- fees / payments: admin y el padre del alumno (profesores no ven cobranza)
create policy fees_select on public.fees for select to authenticated
  using (public.is_admin() or public.parent_has_student(student_id));
create policy fees_write on public.fees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or public.parent_has_student(student_id));
create policy payments_write on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- trainings
create policy trainings_select on public.trainings for select to authenticated using (
  public.is_admin() or public.coach_has_category(category_id) or public.parent_has_category(category_id)
);
create policy trainings_write on public.trainings for all to authenticated
  using (public.is_admin() or public.coach_has_category(category_id))
  with check (public.is_admin() or public.coach_has_category(category_id));

-- attendance
create policy attendance_select on public.attendance for select to authenticated
  using (public.can_see_student(student_id));
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_admin() or exists (
    select 1 from public.trainings t where t.id = training_id and public.coach_has_category(t.category_id)))
  with check (public.is_admin() or exists (
    select 1 from public.trainings t where t.id = training_id and public.coach_has_category(t.category_id)));

-- matches
create policy matches_select on public.matches for select to authenticated using (
  public.is_admin() or public.coach_has_category(category_id) or public.parent_has_category(category_id)
);
create policy matches_write on public.matches for all to authenticated
  using (public.is_admin() or public.coach_has_category(category_id))
  with check (public.is_admin() or public.coach_has_category(category_id));

-- match_players: el padre sólo ve las filas de su hijo
create policy match_players_select on public.match_players for select to authenticated using (
  public.is_admin() or public.parent_has_student(student_id) or exists (
    select 1 from public.matches m where m.id = match_id and public.coach_has_category(m.category_id))
);
create policy match_players_write on public.match_players for all to authenticated
  using (public.is_admin() or exists (
    select 1 from public.matches m where m.id = match_id and public.coach_has_category(m.category_id)))
  with check (public.is_admin() or exists (
    select 1 from public.matches m where m.id = match_id and public.coach_has_category(m.category_id)));

-- evaluations
create policy evaluations_select on public.evaluations for select to authenticated
  using (public.can_see_student(student_id));
create policy evaluations_insert on public.evaluations for insert to authenticated
  with check (public.is_admin() or (public.coach_has_student(student_id) and coach_id = auth.uid()));
create policy evaluations_update on public.evaluations for update to authenticated
  using (public.is_admin() or (coach_id = auth.uid() and public.coach_has_student(student_id)))
  with check (public.is_admin() or (coach_id = auth.uid() and public.coach_has_student(student_id)));
create policy evaluations_delete on public.evaluations for delete to authenticated
  using (public.is_admin() or (coach_id = auth.uid() and public.coach_has_student(student_id)));

-- reports
create policy reports_select on public.reports for select to authenticated
  using (public.can_see_student(student_id));
create policy reports_insert on public.reports for insert to authenticated
  with check (public.is_admin() or public.coach_has_student(student_id));
create policy reports_delete on public.reports for delete to authenticated
  using (public.is_admin());

-- Privilegios base (RLS decide qué filas)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
