-- =====================================================================
-- CLASES EXTRA (p. ej. Porteros)
-- Una categoría marcada como "clase extra" la toman alumnos ADEMÁS de su
-- categoría de edad. No cambia su categoría ni su mensualidad.
-- En los reportes: la clase extra no carga gastos generales (los niños ya
-- cuentan en su categoría); sólo se le resta el sueldo de su profesor.
-- =====================================================================

alter table academia.categories add column if not exists is_extra boolean not null default false;
update academia.categories set is_extra = true where lower(name) = 'porteros';

create table if not exists academia.student_extra_classes (
  student_id   uuid not null references academia.students (id) on delete cascade,
  category_id  uuid not null references academia.categories (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (student_id, category_id)
);

alter table academia.student_extra_classes enable row level security;

create policy extra_classes_select on academia.student_extra_classes for select to authenticated
  using (academia.can_see_student(student_id));
create policy extra_classes_write on academia.student_extra_classes for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy extra_classes_open_mode on academia.student_extra_classes for all to anon
  using (academia.open_mode()) with check (academia.open_mode());

grant select, insert, update, delete on academia.student_extra_classes to authenticated, anon;

-- El profesor de una clase extra también ve a sus alumnos
create or replace function academia.coach_has_student(stu uuid)
returns boolean language sql stable security definer set search_path = academia, public as $$
  select exists (
    select 1 from academia.students s
    where s.id = stu and academia.my_coach_id() is not null
      and (s.coach_id = academia.my_coach_id()
           or exists (select 1 from academia.coach_categories cc
                      where cc.coach_id = academia.my_coach_id() and cc.category_id = s.category_id)
           or exists (select 1 from academia.student_extra_classes x
                      join academia.coach_categories cc on cc.category_id = x.category_id
                      where x.student_id = s.id and cc.coach_id = academia.my_coach_id()))
  )
$$;

-- Asistencia: se permite en su categoría o en una clase extra en la que esté inscrito
create or replace function academia.validate_attendance()
returns trigger language plpgsql security definer set search_path = academia, public as $$
begin
  if not exists (
    select 1 from academia.trainings t
    join academia.students s on s.id = new.student_id
    where t.id = new.training_id
      and (s.category_id = t.category_id
           or exists (select 1 from academia.student_extra_classes x
                      where x.student_id = s.id and x.category_id = t.category_id))
  ) then
    raise exception 'El alumno no pertenece a la categoría de este entrenamiento';
  end if;
  new.updated_at := now();
  return new;
end $$;
