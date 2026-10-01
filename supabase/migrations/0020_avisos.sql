-- =====================================================================
-- AVISOS EN EL DASHBOARD
-- Cada cambio en la caja (corregir un corte, agregar un pago o gasto para
-- cuadrar, borrar un corte) deja un aviso hasta que alguien lo marca como visto.
-- =====================================================================
create table if not exists academia.notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'caja',
  title       text not null,
  body        text,
  link        text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
create index if not exists notifications_unseen_idx on academia.notifications (created_at desc) where seen_at is null;
alter table academia.notifications enable row level security;
create policy notifications_admin on academia.notifications for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy notifications_open_mode on academia.notifications for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.notifications to authenticated, anon;
