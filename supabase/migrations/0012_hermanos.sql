-- =====================================================================
-- PROMOCIÓN DE HERMANOS
-- Hermanos inscritos juntos pagan menos, según su orden en el grupo:
--   1° $500 · 2° $450 · 3° en adelante $400   (settings.sibling_prices)
-- Candado: la promoción sólo es válida mientras TODOS los hermanos del grupo
-- sigan inscritos (activos). Si alguno se da de baja, deja de aplicarse.
-- Además se alerta cuando algún hermano tiene pagos vencidos.
-- Casos especiales: cada hermano puede tener un precio manual (sibling_price).
-- El descuento se registra en cada mensualidad (discount, motivo "Promo hermanos").
-- =====================================================================

alter table academia.settings
  add column if not exists sibling_prices numeric(10,2)[] not null default '{500,450,400}';

create table academia.sibling_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table academia.students
  add column if not exists sibling_group_id uuid references academia.sibling_groups (id) on delete set null,
  add column if not exists sibling_order    smallint check (sibling_order is null or sibling_order between 1 and 10),
  -- Precio especial dentro de la promo (casos que no siguen 500/450/400). null = precio según el orden.
  add column if not exists sibling_price    numeric(10,2) check (sibling_price is null or sibling_price >= 0);

create index if not exists students_sibling_group_idx on academia.students (sibling_group_id);

alter table academia.sibling_groups enable row level security;

create policy sibling_groups_select on academia.sibling_groups for select to authenticated using (
  academia.is_admin() or exists (
    select 1 from academia.students s where s.sibling_group_id = sibling_groups.id and academia.can_see_student(s.id))
);
create policy sibling_groups_write on academia.sibling_groups for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
create policy sibling_groups_open_mode on academia.sibling_groups for all to anon
  using (academia.open_mode()) with check (academia.open_mode());

grant select, insert, update, delete on academia.sibling_groups to authenticated, anon;
