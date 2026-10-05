-- =====================================================================
-- QUIÉN RECIBE EL PAGO
-- Nombre de la persona del equipo Rancho Seco que recibió cada pago.
-- =====================================================================
alter table academia.payments add column if not exists received_by text;
