-- =====================================================================
-- PLAYERA DE ENTRENAMIENTO INCLUIDA EN LA INSCRIPCIÓN
-- La primera playera no se cobra aparte (va con la inscripción).
-- Sólo se cobra cuando se pierde: "Playera de entrenamiento (reposición)".
-- deliveries.payment = 'incluida' para la que va con la inscripción.
-- =====================================================================
alter table academia.deliveries drop constraint if exists deliveries_payment_check;
alter table academia.deliveries add constraint deliveries_payment_check
  check (payment in ('pagado', 'adeudo', 'previo', 'incluida'));

create or replace function academia.trg_act_deliveries() returns trigger
language plpgsql security definer set search_path = academia, public as $$
declare r academia.deliveries;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' then return null; end if;
  perform academia.act_log('alumno',
    case when tg_op = 'INSERT' then 'Se entregó ' else 'Se quitó la entrega de ' end
      || case r.item when 'uniforme' then 'el uniforme' when 'playera' then 'la playera de entrenamiento' else 'la credencial' end
      || ' a ' || academia.act_student(r.student_id),
    case when tg_op = 'INSERT' then concat_ws(' · ',
      case r.payment when 'pagado' then 'Ya pagado' when 'adeudo' then 'SIN PAGAR: queda como adeudo'
        when 'incluida' then 'Incluida en la inscripción' else 'Pagado antes de la plataforma' end,
      'Entregó: ' || r.delivered_by, r.notes) end,
    '/alumnos/' || r.student_id, r.student_id);
  return null;
exception when others then return null;
end $$;
