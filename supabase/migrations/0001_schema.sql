-- =====================================================================
-- RANCHO SECO | CONTROL DE ACADEMIA — Esquema base
-- Postgres / Supabase. Toda la seguridad se aplica con Row Level Security.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Esquema propio (convive con otros proyectos en la misma base de datos)
-- ---------------------------------------------------------------------
create schema if not exists academia;
grant usage on schema academia to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type academia.app_role as enum ('admin', 'profesor', 'padre');
create type academia.student_status as enum ('activo', 'suspendido', 'baja');
create type academia.attendance_status as enum ('presente', 'falta', 'justificada', 'retardo');
create type academia.payment_method as enum ('efectivo', 'transferencia', 'tarjeta', 'deposito', 'otro');
create type academia.match_status as enum ('programado', 'jugado', 'cancelado');

-- ---------------------------------------------------------------------
-- Usuarios y roles
-- ---------------------------------------------------------------------
create table academia.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  phone       text,
  role        academia.app_role not null default 'padre',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configuración general (una sola fila)
-- ---------------------------------------------------------------------
create table academia.settings (
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
insert into academia.settings (id) values (1);

-- ---------------------------------------------------------------------
-- Categorías y profesores asignados
-- ---------------------------------------------------------------------
create table academia.categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  schedule     text,
  monthly_fee  numeric(10,2),
  sort_order   smallint not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Profesores: existen aunque no tengan cuenta de acceso (user_id opcional).
create table academia.coaches (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  email       text,
  active      boolean not null default true,
  user_id     uuid unique references academia.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table academia.coach_categories (
  coach_id     uuid not null references academia.coaches (id) on delete cascade,
  category_id  uuid not null references academia.categories (id) on delete cascade,
  primary key (coach_id, category_id)
);

-- ---------------------------------------------------------------------
-- Tutores y alumnos
-- ---------------------------------------------------------------------
create table academia.guardians (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text not null check (phone ~ '^[0-9]{10,15}$'),  -- internacional, sólo dígitos (ej. 5215512345678)
  email         text,
  relationship  text,
  user_id       uuid unique references academia.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table academia.students (
  id                       uuid primary key default gen_random_uuid(),
  full_name                text not null,
  photo_path               text,
  birth_date               date,
  category_id              uuid references academia.categories (id) on delete set null,
  coach_id                 uuid references academia.coaches (id) on delete set null,
  enrolled_at              date not null default current_date,
  status                   academia.student_status not null default 'activo',
  emergency_contact_name   text,
  emergency_contact_phone  text,
  notes                    text,
  created_at               timestamptz not null default now()
);
create index students_category_idx on academia.students (category_id);
create index students_name_idx on academia.students (lower(full_name));

create table academia.student_guardians (
  student_id   uuid not null references academia.students (id) on delete cascade,
  guardian_id  uuid not null references academia.guardians (id) on delete cascade,
  is_primary   boolean not null default true,
  primary key (student_id, guardian_id)
);

-- Información médica: tabla aparte para restringir su acceso.
create table academia.student_medical (
  student_id   uuid primary key references academia.students (id) on delete cascade,
  blood_type   text,
  allergies    text,
  conditions   text,
  medications  text,
  insurance    text,
  notes        text,
  updated_at   timestamptz not null default now()
);

-- Historial de inscripciones por categoría (lo llena un trigger).
create table academia.enrollments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references academia.students (id) on delete cascade,
  category_id  uuid references academia.categories (id) on delete set null,
  start_date   date not null default current_date,
  end_date     date,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Mensualidades y pagos
-- ---------------------------------------------------------------------
create table academia.fees (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references academia.students (id) on delete cascade,
  concept     text not null default 'Mensualidad',
  period      date not null,               -- primer día del mes que cubre
  amount      numeric(10,2) not null check (amount > 0),
  due_date    date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (student_id, concept, period)
);
create index fees_student_idx on academia.fees (student_id);

create table academia.payments (
  id            uuid primary key default gen_random_uuid(),
  fee_id        uuid not null references academia.fees (id) on delete cascade,
  student_id    uuid not null references academia.students (id) on delete cascade,
  amount        numeric(10,2) not null check (amount > 0),
  paid_at       date not null default current_date,
  method        academia.payment_method not null default 'efectivo',
  receipt_path  text,
  notes         text,
  recorded_by   uuid references academia.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index payments_fee_idx on academia.payments (fee_id);

-- ---------------------------------------------------------------------
-- Entrenamientos, asistencias y partidos
-- ---------------------------------------------------------------------
create table academia.trainings (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references academia.categories (id) on delete cascade,
  coach_id     uuid references academia.coaches (id) on delete set null,
  date         date not null,
  start_time   time,
  end_time     time,
  objectives   text,
  exercises    text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index trainings_cat_date_idx on academia.trainings (category_id, date);

create table academia.attendance (
  id           uuid primary key default gen_random_uuid(),
  training_id  uuid not null references academia.trainings (id) on delete cascade,
  student_id   uuid not null references academia.students (id) on delete cascade,
  status       academia.attendance_status not null,
  notes        text,
  recorded_by  uuid references academia.profiles (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (training_id, student_id)
);
create index attendance_student_idx on academia.attendance (student_id);

create table academia.matches (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references academia.categories (id) on delete cascade,
  opponent       text not null,
  date           date not null,
  time           time,
  venue          text,
  is_home        boolean not null default true,
  goals_for      smallint check (goals_for >= 0),
  goals_against  smallint check (goals_against >= 0),
  status         academia.match_status not null default 'programado',
  notes          text,
  created_by     uuid references academia.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index matches_cat_date_idx on academia.matches (category_id, date);

-- Convocatoria, alineación y estadísticas individuales.
create table academia.match_players (
  match_id    uuid not null references academia.matches (id) on delete cascade,
  student_id  uuid not null references academia.students (id) on delete cascade,
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
create table academia.evaluations (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references academia.students (id) on delete cascade,
  coach_id         uuid references academia.coaches (id) on delete set null,
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
create index evaluations_student_idx on academia.evaluations (student_id, date);

-- ---------------------------------------------------------------------
-- Reportes PDF generados
-- ---------------------------------------------------------------------
create table academia.reports (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references academia.students (id) on delete cascade,
  period_from   date not null,
  period_to     date not null,
  file_path     text,
  generated_by  uuid references academia.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index reports_student_idx on academia.reports (student_id);

-- =====================================================================
-- Funciones auxiliares de autorización (SECURITY DEFINER evita recursión RLS)
-- =====================================================================
create or replace function academia.current_app_role()
returns academia.app_role language sql stable security definer set search_path = academia, public as $$
  select role from academia.profiles where id = auth.uid() and active
$$;

create or replace function academia.is_admin()
returns boolean language sql stable security definer set search_path = academia, public as $$
  select coalesce((select role = 'admin' from academia.profiles where id = auth.uid() and active), false)
$$;

create or replace function academia.my_coach_id()
returns uuid language sql stable security definer set search_path = academia, public as $$
  select c.id from academia.coaches c
  join academia.profiles p on p.id = c.user_id and p.active and p.role = 'profesor'
  where c.user_id = auth.uid() and c.active
$$;

create or replace function academia.coach_has_category(cat uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select exists (
    select 1 from academia.coach_categories cc
    where cc.coach_id = academia.my_coach_id() and cc.category_id = cat
  )
$$;

create or replace function academia.coach_has_student(stu uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select exists (
    select 1 from academia.students s
    where s.id = stu and academia.my_coach_id() is not null
      and (s.coach_id = academia.my_coach_id()
           or exists (select 1 from academia.coach_categories cc
                      where cc.coach_id = academia.my_coach_id() and cc.category_id = s.category_id))
  )
$$;

create or replace function academia.parent_has_student(stu uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select exists (
    select 1 from academia.student_guardians sg
    join academia.guardians g on g.id = sg.guardian_id
    join academia.profiles p on p.id = g.user_id and p.active
    where sg.student_id = stu and g.user_id = auth.uid()
  )
$$;

create or replace function academia.parent_has_category(cat uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select exists (
    select 1 from academia.students s
    where s.category_id = cat and academia.parent_has_student(s.id)
  )
$$;

create or replace function academia.can_see_student(stu uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select academia.is_admin() or academia.coach_has_student(stu) or academia.parent_has_student(stu)
$$;

-- =====================================================================
-- Triggers
-- =====================================================================

-- Proyecto de Supabase compartido: NO se crea perfil automáticamente al
-- registrarse alguien en Auth. Sólo tienen acceso los usuarios a los que el
-- administrador les crea un perfil (Edge Function admin-users o SQL de arranque).
-- Un usuario de Auth sin perfil en academia.profiles no ve ningún dato.

-- Un usuario puede editar su nombre/teléfono, pero no su rol ni su estado.
create or replace function academia.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = academia, public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not academia.is_admin() and auth.uid() is not null then
    raise exception 'Sólo un administrador puede cambiar roles o estatus';
  end if;
  return new;
end $$;

create trigger profiles_protect before update on academia.profiles
  for each row execute function academia.protect_profile_fields();

-- Historial de inscripción cuando cambia la categoría del alumno.
create or replace function academia.track_enrollment()
returns trigger language plpgsql security definer set search_path = academia, public as $$
begin
  if tg_op = 'INSERT' then
    insert into academia.enrollments (student_id, category_id, start_date)
    values (new.id, new.category_id, new.enrolled_at);
  elsif new.category_id is distinct from old.category_id then
    update academia.enrollments set end_date = current_date
     where student_id = new.id and end_date is null;
    insert into academia.enrollments (student_id, category_id, start_date)
    values (new.id, new.category_id, current_date);
  end if;
  return new;
end $$;

create trigger students_enrollment after insert or update of category_id on academia.students
  for each row execute function academia.track_enrollment();

-- Un pago no puede exceder el saldo del cargo y debe pertenecer al mismo alumno.
create or replace function academia.validate_payment()
returns trigger language plpgsql security definer set search_path = academia, public as $$
declare
  fee_amount numeric; fee_student uuid; paid numeric;
begin
  select amount, student_id into fee_amount, fee_student from academia.fees where id = new.fee_id;
  if fee_student is distinct from new.student_id then
    raise exception 'El pago no corresponde al alumno del cargo';
  end if;
  select coalesce(sum(amount), 0) into paid from academia.payments
   where fee_id = new.fee_id and id is distinct from new.id;
  if paid + new.amount > fee_amount then
    raise exception 'El pago (%) excede el saldo pendiente (%)', new.amount, fee_amount - paid;
  end if;
  return new;
end $$;

create trigger payments_validate before insert or update on academia.payments
  for each row execute function academia.validate_payment();

-- Asistencia sólo para alumnos de la categoría del entrenamiento.
create or replace function academia.validate_attendance()
returns trigger language plpgsql security definer set search_path = academia, public as $$
begin
  if not exists (
    select 1 from academia.trainings t join academia.students s on s.category_id = t.category_id
    where t.id = new.training_id and s.id = new.student_id
  ) then
    raise exception 'El alumno no pertenece a la categoría de este entrenamiento';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger attendance_validate before insert or update on academia.attendance
  for each row execute function academia.validate_attendance();

-- =====================================================================
-- Vistas (security_invoker => respetan el RLS de quien consulta)
-- =====================================================================
create view academia.fee_balances with (security_invoker = true) as
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
from academia.fees f
left join lateral (
  select sum(amount) as paid, max(paid_at) as last_paid_at
  from academia.payments where fee_id = f.id
) p on true;

-- Resumen de cuenta por alumno.
create view academia.student_accounts with (security_invoker = true) as
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
from academia.students s
left join academia.fee_balances fb on fb.student_id = s.id
group by s.id;

-- Asistencia con fecha y categoría del entrenamiento.
create view academia.attendance_detail with (security_invoker = true) as
select a.id, a.training_id, a.student_id, a.status, a.notes, a.updated_at,
       t.date, t.category_id, t.start_time
from academia.attendance a
join academia.trainings t on t.id = a.training_id;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table academia.profiles          enable row level security;
alter table academia.settings          enable row level security;
alter table academia.categories        enable row level security;
alter table academia.coaches           enable row level security;
alter table academia.coach_categories  enable row level security;
alter table academia.guardians         enable row level security;
alter table academia.students          enable row level security;
alter table academia.student_guardians enable row level security;
alter table academia.student_medical   enable row level security;
alter table academia.enrollments       enable row level security;
alter table academia.fees              enable row level security;
alter table academia.payments          enable row level security;
alter table academia.trainings         enable row level security;
alter table academia.attendance        enable row level security;
alter table academia.matches           enable row level security;
alter table academia.match_players     enable row level security;
alter table academia.evaluations       enable row level security;
alter table academia.reports           enable row level security;

-- profiles: cada quien ve su perfil; todos ven a admins y profesores (nombre del profe);
-- el profesor ve los perfiles de los padres de sus alumnos; admin ve y edita todo.
create policy profiles_select on academia.profiles for select to authenticated using (
  id = auth.uid() or academia.is_admin() or role in ('admin', 'profesor')
);
create policy profiles_update_self on academia.profiles for update to authenticated
  using (id = auth.uid() or academia.is_admin())
  with check (id = auth.uid() or academia.is_admin());
create policy profiles_admin_insert on academia.profiles for insert to authenticated with check (academia.is_admin());
create policy profiles_admin_delete on academia.profiles for delete to authenticated using (academia.is_admin());

-- settings
create policy settings_select on academia.settings for select to authenticated using (true);
create policy settings_update on academia.settings for update to authenticated using (academia.is_admin()) with check (academia.is_admin());

-- categories
create policy categories_select on academia.categories for select to authenticated using (
  academia.is_admin() or academia.coach_has_category(id) or academia.parent_has_category(id)
);
create policy categories_write on academia.categories for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- coaches: visibles para usuarios con perfil; sólo el admin los edita
create policy coaches_select on academia.coaches for select to authenticated using (
  academia.current_app_role() is not null
);
create policy coaches_write on academia.coaches for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- coach_categories
create policy coach_categories_select on academia.coach_categories for select to authenticated using (
  academia.is_admin() or coach_id = academia.my_coach_id() or academia.parent_has_category(category_id)
);
create policy coach_categories_write on academia.coach_categories for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- students
create policy students_select on academia.students for select to authenticated using (academia.can_see_student(id));
create policy students_write on academia.students for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- guardians: admin; profesor de alguno de sus hijos; el propio padre.
create policy guardians_select on academia.guardians for select to authenticated using (
  academia.is_admin() or user_id = auth.uid() or exists (
    select 1 from academia.student_guardians sg
    where sg.guardian_id = guardians.id and academia.coach_has_student(sg.student_id)
  )
);
create policy guardians_write on academia.guardians for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- student_guardians
create policy student_guardians_select on academia.student_guardians for select to authenticated
  using (academia.can_see_student(student_id));
create policy student_guardians_write on academia.student_guardians for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- student_medical: acceso restringido (admin, profesor responsable, padre del alumno)
create policy medical_select on academia.student_medical for select to authenticated
  using (academia.can_see_student(student_id));
create policy medical_write on academia.student_medical for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- enrollments
create policy enrollments_select on academia.enrollments for select to authenticated
  using (academia.can_see_student(student_id));
create policy enrollments_write on academia.enrollments for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- fees / payments: admin y el padre del alumno (profesores no ven cobranza)
create policy fees_select on academia.fees for select to authenticated
  using (academia.is_admin() or academia.parent_has_student(student_id));
create policy fees_write on academia.fees for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

create policy payments_select on academia.payments for select to authenticated
  using (academia.is_admin() or academia.parent_has_student(student_id));
create policy payments_write on academia.payments for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());

-- trainings
create policy trainings_select on academia.trainings for select to authenticated using (
  academia.is_admin() or academia.coach_has_category(category_id) or academia.parent_has_category(category_id)
);
create policy trainings_write on academia.trainings for all to authenticated
  using (academia.is_admin() or academia.coach_has_category(category_id))
  with check (academia.is_admin() or academia.coach_has_category(category_id));

-- attendance
create policy attendance_select on academia.attendance for select to authenticated
  using (academia.can_see_student(student_id));
create policy attendance_write on academia.attendance for all to authenticated
  using (academia.is_admin() or exists (
    select 1 from academia.trainings t where t.id = training_id and academia.coach_has_category(t.category_id)))
  with check (academia.is_admin() or exists (
    select 1 from academia.trainings t where t.id = training_id and academia.coach_has_category(t.category_id)));

-- matches
create policy matches_select on academia.matches for select to authenticated using (
  academia.is_admin() or academia.coach_has_category(category_id) or academia.parent_has_category(category_id)
);
create policy matches_write on academia.matches for all to authenticated
  using (academia.is_admin() or academia.coach_has_category(category_id))
  with check (academia.is_admin() or academia.coach_has_category(category_id));

-- match_players: el padre sólo ve las filas de su hijo
create policy match_players_select on academia.match_players for select to authenticated using (
  academia.is_admin() or academia.parent_has_student(student_id) or exists (
    select 1 from academia.matches m where m.id = match_id and academia.coach_has_category(m.category_id))
);
create policy match_players_write on academia.match_players for all to authenticated
  using (academia.is_admin() or exists (
    select 1 from academia.matches m where m.id = match_id and academia.coach_has_category(m.category_id)))
  with check (academia.is_admin() or exists (
    select 1 from academia.matches m where m.id = match_id and academia.coach_has_category(m.category_id)));

-- evaluations
create policy evaluations_select on academia.evaluations for select to authenticated
  using (academia.can_see_student(student_id));
create policy evaluations_insert on academia.evaluations for insert to authenticated
  with check (academia.is_admin() or (academia.coach_has_student(student_id) and coach_id = academia.my_coach_id()));
create policy evaluations_update on academia.evaluations for update to authenticated
  using (academia.is_admin() or (coach_id = academia.my_coach_id() and academia.coach_has_student(student_id)))
  with check (academia.is_admin() or (coach_id = academia.my_coach_id() and academia.coach_has_student(student_id)));
create policy evaluations_delete on academia.evaluations for delete to authenticated
  using (academia.is_admin() or (coach_id = academia.my_coach_id() and academia.coach_has_student(student_id)));

-- reports
create policy reports_select on academia.reports for select to authenticated
  using (academia.can_see_student(student_id));
create policy reports_insert on academia.reports for insert to authenticated
  with check (academia.is_admin() or academia.coach_has_student(student_id));
create policy reports_delete on academia.reports for delete to authenticated
  using (academia.is_admin());

-- Privilegios base (RLS decide qué filas)
grant select, insert, update, delete on all tables in schema academia to authenticated;
grant execute on all functions in schema academia to authenticated;
revoke all on all tables in schema academia from anon;
