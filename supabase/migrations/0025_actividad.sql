-- =====================================================================
-- ACTIVIDAD EN EL SITIO (bitácora automática)
-- Cada cambio en la base de datos queda anotado solo: quién lo hizo, a qué
-- hora y qué cambió (pagos, abonos, cargos, alumnos, papás, listas, partidos,
-- gastos, cortes, sueldos, configuración…). Quien lo hizo llega en el
-- encabezado x-actor-id (el "¿Quién eres?" del equipo Rancho Seco).
-- Si algo falla al anotar, el cambio se guarda igual (la bitácora nunca estorba).
-- =====================================================================
create table if not exists academia.activity (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       text,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  student_id  uuid,
  ref         text   -- para juntar en un solo renglón (p. ej. la lista de un entrenamiento)
);
create index if not exists activity_at_idx on academia.activity (at desc);
create index if not exists activity_ref_idx on academia.activity (ref, at desc) where ref is not null;
alter table academia.activity enable row level security;
drop policy if exists activity_admin on academia.activity;
create policy activity_admin on academia.activity for select to authenticated using (academia.is_admin());
drop policy if exists activity_open_mode on academia.activity;
create policy activity_open_mode on academia.activity for select to anon using (academia.open_mode());
grant select on academia.activity to authenticated, anon;

-- ---------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------
create or replace function academia.act_actor() returns text
language plpgsql stable security definer set search_path = academia, public as $$
declare h json; v text;
begin
  if coalesce(current_setting('request.path', true), '') like '%registro_guardar%' then
    return 'Papá/mamá (formulario de registro)';
  end if;
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  if h is null then return 'Sistema'; end if;
  v := h ->> 'x-actor-id';
  if v is null or v = '' then return null; end if;
  select full_name into v from academia.team_members where id::text = v;
  return v;
end $$;

create or replace function academia.act_money(n numeric) returns text language sql immutable as $$
  select '$' || case when n = trunc(n) then to_char(n, 'FM999,999,990') else to_char(n, 'FM999,999,990.00') end
$$;

create or replace function academia.act_mes(d date) returns text language sql immutable as $$
  select (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from d)::int] || ' ' || extract(year from d)::int
$$;

create or replace function academia.act_fecha(d date) returns text language sql immutable as $$
  select case when d is null then '—' else extract(day from d)::int || ' ' || (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from d)::int] end
$$;

create or replace function academia.act_student(id uuid) returns text language sql stable security definer set search_path = academia, public as $$
  select coalesce((select full_name from academia.students s where s.id = act_student.id), 'Alumno')
$$;

create or replace function academia.act_cat(id uuid) returns text language sql stable security definer set search_path = academia, public as $$
  select coalesce((select name from academia.categories c where c.id = act_cat.id), 'sin categoría')
$$;

create or replace function academia.act_log(p_kind text, p_title text, p_body text, p_link text, p_student uuid)
returns void language plpgsql security definer set search_path = academia, public as $$
begin
  insert into academia.activity (actor, kind, title, body, link, student_id)
  values (academia.act_actor(), p_kind, p_title, nullif(p_body, ''), p_link, p_student);
end $$;

-- Igual que act_log, pero si la misma persona hizo lo mismo hace poco, actualiza ese renglón
create or replace function academia.act_merge(p_ref text, p_kind text, p_title text, p_body text, p_link text, p_student uuid)
returns void language plpgsql security definer set search_path = academia, public as $$
declare v_actor text := academia.act_actor();
begin
  update academia.activity set title = p_title, body = nullif(p_body, ''), at = now()
   where ref = p_ref and actor is not distinct from v_actor and at > now() - interval '30 minutes';
  if not found then
    insert into academia.activity (actor, kind, title, body, link, student_id, ref)
    values (v_actor, p_kind, p_title, nullif(p_body, ''), p_link, p_student, p_ref);
  end if;
end $$;

-- "Campo: antes → después" si cambió
create or replace function academia.act_diff(label text, a text, b text) returns text language sql immutable as $$
  select case when a is distinct from b then label || ': ' || coalesce(nullif(a, ''), '—') || ' → ' || coalesce(nullif(b, ''), '—') end
$$;

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create or replace function academia.trg_act_payments_ins() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare r record;
begin
  for r in
    select n.student_id, sum(n.amount) as total,
           string_agg(coalesce(f.concept, 'Cargo') || ' ' || coalesce(academia.act_mes(f.period), '') || ' ' || academia.act_money(n.amount), ', ' order by f.period) as detalle,
           bool_or(coalesce(fb.balance, 0) > 0) as abono,
           string_agg(distinct n.method::text, ', ') as metodo,
           string_agg(distinct n.received_by, ', ') as recibio
      from nt n
      left join academia.fees f on f.id = n.fee_id
      left join academia.fee_balances fb on fb.id = n.fee_id
     group by n.student_id
  loop
    perform academia.act_log('pago',
      academia.act_student(r.student_id) || case when r.abono then ' abonó ' else ' pagó ' end || academia.act_money(r.total),
      r.detalle || ' · ' || r.metodo || coalesce(' · recibió ' || r.recibio, '') || case when r.abono then ' · aún debe una parte' else '' end,
      '/alumnos/' || r.student_id || '?tab=pagos', r.student_id);
  end loop;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_payments() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'DELETE' then
    perform academia.act_log('pago', 'Se borró un pago de ' || academia.act_student(old.student_id),
      academia.act_money(old.amount) || ' del ' || academia.act_fecha(old.paid_at), '/alumnos/' || old.student_id || '?tab=pagos', old.student_id);
  else
    ch := concat_ws(' · ',
      academia.act_diff('Monto', academia.act_money(old.amount), academia.act_money(new.amount)),
      academia.act_diff('Fecha', academia.act_fecha(old.paid_at), academia.act_fecha(new.paid_at)),
      academia.act_diff('Forma de pago', old.method::text, new.method::text),
      academia.act_diff('Recibió', old.received_by, new.received_by),
      case when old.fee_id is distinct from new.fee_id then 'Se pasó a otro cargo' end,
      case when old.notes is distinct from new.notes then 'Notas' end);
    if ch <> '' then
      perform academia.act_log('pago', 'Se corrigió un pago de ' || academia.act_student(new.student_id), ch,
        '/alumnos/' || new.student_id || '?tab=pagos', new.student_id);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Cargos (mensualidades, inscripciones, playeras…)
-- ---------------------------------------------------------------------
create or replace function academia.trg_act_fees_ins() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare n int; r record;
begin
  select count(*) into n from nt;
  if n = 0 then return null; end if;
  if n > 3 then
    perform academia.act_log('cargo', 'Se crearon ' || n || ' cargos',
      (select string_agg(x.c || ' ' || x.k, ', ') from (select concept || ' ' || academia.act_mes(period) as k, count(*) || ' ×' as c from nt group by 1 order by 1) x),
      '/cobranza', null);
  else
    for r in select * from nt loop
      perform academia.act_log('cargo', 'Nuevo cargo para ' || academia.act_student(r.student_id),
        r.concept || ' ' || academia.act_mes(r.period) || ' · ' || academia.act_money(r.amount), '/alumnos/' || r.student_id || '?tab=pagos', r.student_id);
    end loop;
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_fees() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'DELETE' then
    perform academia.act_log('cargo', 'Se borró un cargo de ' || academia.act_student(old.student_id),
      old.concept || ' ' || academia.act_mes(old.period) || ' · ' || academia.act_money(old.amount), '/alumnos/' || old.student_id || '?tab=pagos', old.student_id);
  else
    ch := concat_ws(' · ',
      academia.act_diff('Concepto', old.concept, new.concept),
      academia.act_diff('Mes', academia.act_mes(old.period), academia.act_mes(new.period)),
      academia.act_diff('Monto', academia.act_money(old.amount), academia.act_money(new.amount)),
      academia.act_diff('Descuento / beca', academia.act_money(old.discount), academia.act_money(new.discount)),
      academia.act_diff('Recargo perdonado', academia.act_money(old.late_fee_waived), academia.act_money(new.late_fee_waived)),
      academia.act_diff('Vence', academia.act_fecha(old.due_date), academia.act_fecha(new.due_date)),
      case when old.review is not null and new.review is null then 'Beca confirmada' end,
      case when new.discount_reason is distinct from old.discount_reason and new.discount_reason is not null then 'Motivo: ' || new.discount_reason end);
    if ch <> '' then
      perform academia.act_log('cargo', 'Cambio en el cargo de ' || academia.act_student(new.student_id) || ' (' || new.concept || ' ' || academia.act_mes(new.period) || ')',
        ch, '/alumnos/' || new.student_id || '?tab=pagos', new.student_id);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Alumnos
-- ---------------------------------------------------------------------
create or replace function academia.act_entrega(label text, a date, b date) returns text language sql immutable as $$
  select case when a is distinct from b then
    case when b is null then label || ': se quitó la entrega' else label || ' entregado(a) el ' || academia.act_fecha(b) end end
$$;

create or replace function academia.trg_act_students() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text; reg boolean;
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('alumno',
      case when new.status::text = 'muestra' then 'Clase muestra: ' else 'Alumno nuevo: ' end || new.full_name,
      'Categoría ' || academia.act_cat(new.category_id), '/alumnos/' || new.id, new.id);
  elsif tg_op = 'DELETE' then
    perform academia.act_log('alumno', 'Se borró al alumno ' || old.full_name, null, '/alumnos', null);
  else
    reg := old.profile_completed_at is null and new.profile_completed_at is not null;
    ch := concat_ws(' · ',
      academia.act_diff('Nombre', old.full_name, new.full_name),
      academia.act_diff('Estatus', old.status::text, new.status::text),
      academia.act_diff('Categoría', academia.act_cat(old.category_id), academia.act_cat(new.category_id)),
      academia.act_diff('Nacimiento', academia.act_fecha(old.birth_date) || ' ' || coalesce(extract(year from old.birth_date)::text, ''), academia.act_fecha(new.birth_date) || ' ' || coalesce(extract(year from new.birth_date)::text, '')),
      academia.act_diff('Fecha de inscripción', academia.act_fecha(old.enrolled_at), academia.act_fecha(new.enrolled_at)),
      academia.act_diff('Cuota especial', academia.act_money(old.monthly_fee), academia.act_money(new.monthly_fee)),
      academia.act_diff('Clase muestra', academia.act_fecha(old.trial_on), academia.act_fecha(new.trial_on)),
      academia.act_diff('Talla', old.uniform_size, new.uniform_size),
      academia.act_entrega('Uniforme', old.uniform_delivered_on, new.uniform_delivered_on),
      academia.act_entrega('Playera de entrenamiento', old.training_shirt_delivered_on, new.training_shirt_delivered_on),
      academia.act_entrega('Credencial', old.credential_delivered_on, new.credential_delivered_on),
      academia.act_diff('Motivo inactivo', old.inactive_reason, new.inactive_reason),
      academia.act_diff('Regresa', academia.act_fecha(old.inactive_until), academia.act_fecha(new.inactive_until)),
      academia.act_diff('Contacto de emergencia', old.emergency_contact_name, new.emergency_contact_name),
      academia.act_diff('Tel. emergencia', old.emergency_contact_phone, new.emergency_contact_phone),
      case when old.sibling_group_id is distinct from new.sibling_group_id then 'Grupo de hermanos' end,
      case when old.coach_id is distinct from new.coach_id then 'Profesor' end,
      case when old.photo_path is distinct from new.photo_path then 'Foto' end,
      case when old.notes is distinct from new.notes then 'Notas' end);
    if reg then
      perform academia.act_log('registro', 'Papás llenaron el registro de ' || new.full_name,
        concat_ws(' · ', 'Lo llenó: ' || new.profile_completed_by, nullif(ch, '')), '/alumnos/' || new.id, new.id);
    elsif ch <> '' then
      perform academia.act_log('alumno', 'Cambios en ' || new.full_name, ch, '/alumnos/' || new.id, new.id);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

-- Papás / tutores
create or replace function academia.trg_act_guardians() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text; kids text; sid uuid;
begin
  if tg_op = 'UPDATE' then
    ch := concat_ws(' · ',
      academia.act_diff('Nombre', old.full_name, new.full_name),
      academia.act_diff('Teléfono', old.phone, new.phone),
      academia.act_diff('Correo', old.email, new.email),
      academia.act_diff('Parentesco', old.relationship, new.relationship));
    if ch <> '' then
      select string_agg(s.full_name, ', '), min(s.id::text)::uuid into kids, sid
        from academia.student_guardians sg join academia.students s on s.id = sg.student_id where sg.guardian_id = new.id;
      perform academia.act_log('papas', 'Datos de ' || coalesce(new.relationship || ' ', '') || new.full_name || coalesce(' (' || kids || ')', ''),
        ch, case when sid is not null then '/alumnos/' || sid end, sid);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_student_guardians() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare g record;
begin
  if tg_op = 'INSERT' then
    select * into g from academia.guardians where id = new.guardian_id;
    perform academia.act_log('papas', 'Se registró ' || coalesce(lower(g.relationship) || ' ', '') || coalesce(g.full_name, '') || ' de ' || academia.act_student(new.student_id),
      'Tel. ' || coalesce(g.phone, '—'), '/alumnos/' || new.student_id, new.student_id);
  elsif tg_op = 'DELETE' then
    select * into g from academia.guardians where id = old.guardian_id;
    if found and exists (select 1 from academia.students where id = old.student_id) then
      perform academia.act_log('papas', 'Se quitó a ' || g.full_name || ' de ' || academia.act_student(old.student_id), null, '/alumnos/' || old.student_id, old.student_id);
    end if;
  elsif new.is_primary and not old.is_primary then
    select * into g from academia.guardians where id = new.guardian_id;
    perform academia.act_log('papas', 'Primer contacto de ' || academia.act_student(new.student_id) || ': ' || g.full_name, null, '/alumnos/' || new.student_id, new.student_id);
  end if;
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Entrenamientos y listas de asistencia
-- ---------------------------------------------------------------------
create or replace function academia.trg_act_trainings() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if tg_op = 'INSERT' then
    -- los que se crean solos al pasar lista se ven en la lista
    if new.objectives is not null or new.exercises is not null or new.notes is not null then
      perform academia.act_log('entrenamiento', 'Entrenamiento nuevo: ' || academia.act_cat(new.category_id) || ' · ' || academia.act_fecha(new.date),
        new.objectives, '/entrenamientos', null);
    end if;
  elsif tg_op = 'DELETE' then
    perform academia.act_log('entrenamiento', 'Se borró el entrenamiento de ' || academia.act_cat(old.category_id) || ' del ' || academia.act_fecha(old.date), null, '/entrenamientos', null);
  elsif (old.date, old.start_time, old.end_time, old.objectives, old.exercises, old.notes, old.category_id, old.coach_id)
        is distinct from (new.date, new.start_time, new.end_time, new.objectives, new.exercises, new.notes, new.category_id, new.coach_id) then
    perform academia.act_merge('entreno:' || new.id, 'entrenamiento', 'Se editó el entrenamiento de ' || academia.act_cat(new.category_id) || ' · ' || academia.act_fecha(new.date),
      concat_ws(' · ', academia.act_diff('Fecha', academia.act_fecha(old.date), academia.act_fecha(new.date)), case when old.objectives is distinct from new.objectives then 'Objetivos' end,
        case when old.exercises is distinct from new.exercises then 'Ejercicios' end, case when old.notes is distinct from new.notes then 'Notas' end), '/entrenamientos', null);
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_attendance() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare tid uuid := coalesce(case when tg_op = 'DELETE' then old.training_id else new.training_id end); t record; c record;
begin
  select * into t from academia.trainings where id = tid;
  if not found then return null; end if;
  select count(*) filter (where status = 'presente') p, count(*) filter (where status = 'falta') f,
         count(*) filter (where status = 'retardo') r, count(*) filter (where status = 'justificada') j
    into c from academia.attendance where training_id = tid;
  perform academia.act_merge('lista:' || tid, 'lista', 'Se tomó lista: ' || academia.act_cat(t.category_id) || ' · ' || academia.act_fecha(t.date),
    c.p || ' asistieron · ' || c.f || ' faltaron' || case when c.r > 0 then ' · ' || c.r || ' retardos' else '' end || case when c.j > 0 then ' · ' || c.j || ' justificadas' else '' end,
    '/asistencias', null);
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Partidos
-- ---------------------------------------------------------------------
create or replace function academia.trg_act_matches() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('partido', 'Partido nuevo: ' || academia.act_cat(new.category_id) || ' vs ' || new.opponent,
      academia.act_fecha(new.date) || coalesce(' ' || to_char(new.time, 'HH24:MI'), '') || coalesce(' · ' || new.venue, ''), '/partidos/' || new.id, null);
  elsif tg_op = 'DELETE' then
    perform academia.act_log('partido', 'Se borró el partido ' || academia.act_cat(old.category_id) || ' vs ' || old.opponent, academia.act_fecha(old.date), '/partidos', null);
  else
    if (old.goals_for, old.goals_against) is distinct from (new.goals_for, new.goals_against) and new.goals_for is not null then
      perform academia.act_log('partido', 'Resultado: ' || academia.act_cat(new.category_id) || ' ' || new.goals_for || '-' || new.goals_against || ' vs ' || new.opponent,
        academia.act_fecha(new.date), '/partidos/' || new.id, null);
    end if;
    ch := concat_ws(' · ',
      academia.act_diff('Estatus', old.status::text, new.status::text),
      academia.act_diff('Fecha', academia.act_fecha(old.date), academia.act_fecha(new.date)),
      academia.act_diff('Hora', to_char(old.time, 'HH24:MI'), to_char(new.time, 'HH24:MI')),
      academia.act_diff('Rival', old.opponent, new.opponent),
      academia.act_diff('Sede', old.venue, new.venue),
      case when old.notes is distinct from new.notes then 'Notas' end);
    if ch <> '' then
      perform academia.act_merge('partido:' || new.id, 'partido', 'Se editó el partido ' || academia.act_cat(new.category_id) || ' vs ' || new.opponent, ch, '/partidos/' || new.id, null);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_match_players() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare mid uuid := case when tg_op = 'DELETE' then old.match_id else new.match_id end; m record; c record;
begin
  select * into m from academia.matches where id = mid;
  if not found then return null; end if;
  select count(*) n, count(*) filter (where attended) a, count(*) filter (where attended is false) f, coalesce(sum(goals), 0) g
    into c from academia.match_players where match_id = mid;
  perform academia.act_merge('convocatoria:' || mid, 'partido', 'Lista del partido: ' || academia.act_cat(m.category_id) || ' vs ' || m.opponent || ' · ' || academia.act_fecha(m.date),
    c.n || ' convocados · ' || c.a || ' asistieron · ' || c.f || ' faltaron' || case when c.g > 0 then ' · ' || c.g || ' goles' else '' end,
    '/partidos/' || mid, null);
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Gastos, partes de gastos, cortes, sueldos
-- ---------------------------------------------------------------------
create or replace function academia.trg_act_expenses() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('gasto', 'Gasto nuevo: ' || new.name, academia.act_money(new.amount) || ' · ' || new.frequency, '/gastos', null);
  elsif tg_op = 'DELETE' then
    perform academia.act_log('gasto', 'Se borró el gasto ' || old.name, academia.act_money(old.amount), '/gastos', null);
  else
    ch := concat_ws(' · ',
      academia.act_diff('Nombre', old.name, new.name),
      academia.act_diff('Monto', academia.act_money(old.amount), academia.act_money(new.amount)),
      academia.act_diff('Frecuencia', old.frequency, new.frequency),
      case when old.active and not new.active then 'Se desactivó' when new.active and not old.active then 'Se activó' end,
      case when old.notes is distinct from new.notes then 'Notas' end);
    if ch <> '' then
      perform academia.act_merge('gasto:' || new.id, 'gasto', 'Cambio en el gasto ' || new.name, ch, '/gastos', null);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_installments() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare e text;
begin
  select name into e from academia.expenses where id = new.expense_id;
  if old.paid_on is distinct from new.paid_on then
    perform academia.act_log('gasto', case when new.paid_on is null then 'Se desmarcó un pago de ' else 'Se pagó una parte de ' end || coalesce(e, 'un gasto'),
      academia.act_money(new.amount) || case when new.paid_on is not null then ' el ' || academia.act_fecha(new.paid_on) else '' end, '/gastos', null);
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_cash_cuts() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare r academia.cash_cuts;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (old.income, old.outflow, old.counted, old.items, old.savings, old.distribution, old.notes, old.period_from, old.period_to)
     is not distinct from (new.income, new.outflow, new.counted, new.items, new.savings, new.distribution, new.notes, new.period_from, new.period_to) then
    return null;
  end if;
  perform academia.act_merge('corte:' || r.id || ':' || tg_op, 'corte',
    case tg_op when 'INSERT' then 'Se hizo el corte de caja del ' when 'UPDATE' then 'Se corrigió el corte del ' else 'Se borró el corte del ' end || academia.act_fecha(r.cut_date),
    'Del ' || academia.act_fecha(r.period_from) || ' al ' || academia.act_fecha(r.period_to) || ' · entró ' || academia.act_money(r.income) || ' · salió ' || academia.act_money(r.outflow) || ' · contado ' || academia.act_money(r.counted),
    '/corte', null);
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_coach_pay_history() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  perform academia.act_log('sueldo', 'Cambio de sueldo: ' || coalesce((select full_name from academia.coaches where id = new.coach_id), 'Profesor'),
    coalesce(academia.act_money(new.previous_amount) || ' → ', '') || academia.act_money(new.amount) || ' ' || new.frequency || coalesce(' · ' || new.reason, ''), '/profesores', null);
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_coaches() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('equipo', 'Profesor nuevo: ' || new.full_name, null, '/profesores', null);
  elsif tg_op = 'DELETE' then
    perform academia.act_log('equipo', 'Se borró al profesor ' || old.full_name, null, '/profesores', null);
  else
    ch := concat_ws(' · ', academia.act_diff('Nombre', old.full_name, new.full_name), academia.act_diff('Teléfono', old.phone, new.phone),
      case when old.active and not new.active then 'Se desactivó' when new.active and not old.active then 'Se activó' end);
    if ch <> '' then perform academia.act_log('equipo', 'Cambios en el profesor ' || new.full_name, ch, '/profesores', null); end if;
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_team() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('equipo', 'Se agregó al equipo: ' || new.full_name, new.role, '/configuracion', null);
  elsif old.active is distinct from new.active or old.full_name is distinct from new.full_name then
    perform academia.act_log('equipo', case when not new.active then 'Se quitó del equipo: ' else 'Cambio en el equipo: ' end || new.full_name,
      academia.act_diff('Nombre', old.full_name, new.full_name), '/configuracion', null);
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_categories() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  if tg_op = 'INSERT' then
    perform academia.act_log('config', 'Categoría nueva: ' || new.name, null, '/categorias', null);
  elsif tg_op = 'DELETE' then
    perform academia.act_log('config', 'Se borró la categoría ' || old.name, null, '/categorias', null);
  else
    ch := concat_ws(' · ', academia.act_diff('Nombre', old.name, new.name), academia.act_diff('Mensualidad', academia.act_money(old.monthly_fee), academia.act_money(new.monthly_fee)),
      academia.act_diff('Horario', old.schedule, new.schedule), case when old.active is distinct from new.active then case when new.active then 'Se activó' else 'Se desactivó' end end);
    if ch <> '' then perform academia.act_log('config', 'Cambio en la categoría ' || new.name, ch, '/categorias', null); end if;
  end if;
  return null;
exception when others then return null;
end $$;

-- Configuración: lista los campos que cambiaron
create or replace function academia.trg_act_settings() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare ch text;
begin
  select string_agg(k.key || ': ' || left(coalesce(o.value #>> '{}', '—'), 40) || ' → ' || left(coalesce(k.value #>> '{}', '—'), 40), ' · ')
    into ch
    from jsonb_each(to_jsonb(new)) k join jsonb_each(to_jsonb(old)) o on o.key = k.key
   where k.value is distinct from o.value and k.key not in ('updated_at');
  if ch is not null then perform academia.act_log('config', 'Se cambió la configuración', ch, '/configuracion', null); end if;
  return null;
exception when others then return null;
end $$;

create or replace function academia.trg_act_evaluations() returns trigger
language plpgsql security definer set search_path = academia, public as $$
begin
  perform academia.act_log('evaluacion', 'Evaluación de habilidades: ' || academia.act_student(new.student_id), academia.act_fecha(new.date), '/alumnos/' || new.student_id, new.student_id);
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------
drop trigger if exists act_payments_ins on academia.payments;
create trigger act_payments_ins after insert on academia.payments referencing new table as nt for each statement execute function academia.trg_act_payments_ins();
drop trigger if exists act_payments on academia.payments;
create trigger act_payments after update or delete on academia.payments for each row execute function academia.trg_act_payments();

drop trigger if exists act_fees_ins on academia.fees;
create trigger act_fees_ins after insert on academia.fees referencing new table as nt for each statement execute function academia.trg_act_fees_ins();
drop trigger if exists act_fees on academia.fees;
create trigger act_fees after update or delete on academia.fees for each row execute function academia.trg_act_fees();

drop trigger if exists act_students on academia.students;
create trigger act_students after insert or update or delete on academia.students for each row execute function academia.trg_act_students();
drop trigger if exists act_guardians on academia.guardians;
create trigger act_guardians after update on academia.guardians for each row execute function academia.trg_act_guardians();
drop trigger if exists act_student_guardians on academia.student_guardians;
create trigger act_student_guardians after insert or update or delete on academia.student_guardians for each row execute function academia.trg_act_student_guardians();

drop trigger if exists act_trainings on academia.trainings;
create trigger act_trainings after insert or update or delete on academia.trainings for each row execute function academia.trg_act_trainings();
drop trigger if exists act_attendance on academia.attendance;
create trigger act_attendance after insert or update or delete on academia.attendance for each row execute function academia.trg_act_attendance();

drop trigger if exists act_matches on academia.matches;
create trigger act_matches after insert or update or delete on academia.matches for each row execute function academia.trg_act_matches();
drop trigger if exists act_match_players on academia.match_players;
create trigger act_match_players after insert or update or delete on academia.match_players for each row execute function academia.trg_act_match_players();

drop trigger if exists act_expenses on academia.expenses;
create trigger act_expenses after insert or update or delete on academia.expenses for each row execute function academia.trg_act_expenses();
drop trigger if exists act_installments on academia.expense_installments;
create trigger act_installments after update on academia.expense_installments for each row execute function academia.trg_act_installments();
drop trigger if exists act_cash_cuts on academia.cash_cuts;
create trigger act_cash_cuts after insert or update or delete on academia.cash_cuts for each row execute function academia.trg_act_cash_cuts();
drop trigger if exists act_coach_pay_history on academia.coach_pay_history;
create trigger act_coach_pay_history after insert on academia.coach_pay_history for each row execute function academia.trg_act_coach_pay_history();
drop trigger if exists act_coaches on academia.coaches;
create trigger act_coaches after insert or update or delete on academia.coaches for each row execute function academia.trg_act_coaches();
drop trigger if exists act_team on academia.team_members;
create trigger act_team after insert or update on academia.team_members for each row execute function academia.trg_act_team();
drop trigger if exists act_categories on academia.categories;
create trigger act_categories after insert or update or delete on academia.categories for each row execute function academia.trg_act_categories();
drop trigger if exists act_settings on academia.settings;
create trigger act_settings after update on academia.settings for each row execute function academia.trg_act_settings();
drop trigger if exists act_evaluations on academia.evaluations;
create trigger act_evaluations after insert on academia.evaluations for each row execute function academia.trg_act_evaluations();
