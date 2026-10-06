-- =====================================================================
-- NUNCA PAGADO DE MÁS: lo pagado siempre corresponde a lo que se debe
-- 1) Al corregir un pago y pasarlo a OTRO cargo, sólo cabe lo que debe ese otro
--    cargo (antes se sumaba el monto del pago como si fuera el mismo cargo).
-- 2) Un descuento, beca o cambio de monto no puede dejar un cargo pagado de más.
-- =====================================================================
create or replace function academia.validate_payment()
returns trigger language plpgsql security definer set search_path = academia, public as $$
declare
  fb record;
  available numeric;
begin
  select * into fb from academia.fee_balances where id = new.fee_id;
  if fb.student_id is distinct from new.student_id then
    raise exception 'El pago no corresponde al alumno del cargo';
  end if;
  -- Si se corrige un pago del MISMO cargo, su monto anterior vuelve a estar disponible
  available := fb.balance + case when tg_op = 'UPDATE' and old.fee_id = new.fee_id then old.amount else 0 end;
  if new.amount > available + 0.001 then
    raise exception 'El pago (%) excede el saldo pendiente (%)', new.amount, available;
  end if;
  return new;
end $$;

create or replace function academia.fee_not_overpaid()
returns trigger language plpgsql security definer set search_path = academia, public as $$
declare b numeric;
begin
  if (new.amount, new.discount, new.late_fee_waived) is not distinct from (old.amount, old.discount, old.late_fee_waived) then
    return null;
  end if;
  select balance into b from academia.fee_balances where id = new.id;
  if b < -0.001 then
    raise exception 'Con ese cambio el cargo quedaría pagado de más por $%. Primero corrige el pago.', round(-b, 2);
  end if;
  return null;
end $$;
drop trigger if exists fees_not_overpaid on academia.fees;
create trigger fees_not_overpaid after update on academia.fees for each row execute function academia.fee_not_overpaid();
