-- =====================================================================
-- CREDENCIAL Y TALLA DESDE EL REGISTRO DE PAPÁS
-- - students.credential_delivered_on: fecha en que se entregó la credencial
-- - La página de registro también guarda la talla de uniforme
-- =====================================================================
alter table academia.students add column if not exists credential_delivered_on date;

create or replace function academia.registro_guardar(p_student uuid, p jsonb)
returns boolean language plpgsql volatile security definer set search_path = academia, public as $$
declare
  st record;
  gid uuid;
  v_phone text := regexp_replace(coalesce(p ->> 'tutor_phone', ''), '\D', '', 'g');
  v_tutor text := nullif(trim(coalesce(p ->> 'tutor_name', '')), '');
begin
  select * into st from academia.students where id = p_student and status in ('activo', 'suspendido');
  if st.id is null then
    raise exception 'Alumno no encontrado';
  end if;
  if st.profile_completed_at is not null then
    raise exception 'Los datos de este alumno ya fueron registrados. Si necesitas corregirlos, avisa a la academia.';
  end if;
  if v_tutor is null then
    raise exception 'Escribe el nombre del papá, mamá o tutor.';
  end if;
  if length(v_phone) = 10 then v_phone := '52' || v_phone; end if;
  if v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'El WhatsApp debe tener 10 dígitos.';
  end if;

  -- Datos del alumno
  update academia.students set
    birth_date = coalesce(nullif(p ->> 'birth_date', '')::date, birth_date),
    emergency_contact_name  = coalesce(nullif(trim(p ->> 'emergency_name'), ''), emergency_contact_name),
    emergency_contact_phone = coalesce(nullif(trim(p ->> 'emergency_phone'), ''), emergency_contact_phone),
    uniform_size = coalesce(nullif(trim(p ->> 'uniform_size'), ''), uniform_size),
    profile_completed_at = now(),
    profile_completed_by = v_tutor
  where id = p_student;

  -- Información médica
  insert into academia.student_medical (student_id, blood_type, allergies, conditions, medications, insurance, notes, updated_at)
  values (p_student, nullif(trim(p ->> 'blood_type'), ''), nullif(trim(p ->> 'allergies'), ''), nullif(trim(p ->> 'conditions'), ''),
          nullif(trim(p ->> 'medications'), ''), nullif(trim(p ->> 'insurance'), ''), nullif(trim(p ->> 'medical_notes'), ''), now())
  on conflict (student_id) do update set
    blood_type = coalesce(excluded.blood_type, student_medical.blood_type),
    allergies = coalesce(excluded.allergies, student_medical.allergies),
    conditions = coalesce(excluded.conditions, student_medical.conditions),
    medications = coalesce(excluded.medications, student_medical.medications),
    insurance = coalesce(excluded.insurance, student_medical.insurance),
    notes = coalesce(excluded.notes, student_medical.notes),
    updated_at = now();

  -- Papá / mamá / tutor principal
  select sg.guardian_id into gid from academia.student_guardians sg
   where sg.student_id = p_student order by sg.is_primary desc limit 1;
  if gid is null then
    insert into academia.guardians (full_name, phone, email, relationship)
    values (v_tutor, v_phone, nullif(trim(p ->> 'tutor_email'), ''), nullif(trim(p ->> 'tutor_relationship'), ''))
    returning id into gid;
    insert into academia.student_guardians (student_id, guardian_id, is_primary) values (p_student, gid, true);
  else
    update academia.guardians set full_name = v_tutor, phone = v_phone,
      email = coalesce(nullif(trim(p ->> 'tutor_email'), ''), email),
      relationship = coalesce(nullif(trim(p ->> 'tutor_relationship'), ''), relationship)
    where id = gid;
  end if;

  -- Segundo tutor (opcional)
  if nullif(trim(coalesce(p ->> 'tutor2_name', '')), '') is not null
     and regexp_replace(coalesce(p ->> 'tutor2_phone', ''), '\D', '', 'g') ~ '^[0-9]{10,15}$' then
    insert into academia.guardians (full_name, phone, relationship)
    values (trim(p ->> 'tutor2_name'),
            case when length(regexp_replace(p ->> 'tutor2_phone', '\D', '', 'g')) = 10
                 then '52' || regexp_replace(p ->> 'tutor2_phone', '\D', '', 'g')
                 else regexp_replace(p ->> 'tutor2_phone', '\D', '', 'g') end,
            nullif(trim(p ->> 'tutor2_relationship'), ''))
    returning id into gid;
    insert into academia.student_guardians (student_id, guardian_id, is_primary) values (p_student, gid, false)
    on conflict do nothing;
  end if;

  return true;
end $$;
