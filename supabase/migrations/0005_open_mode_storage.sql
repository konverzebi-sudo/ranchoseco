-- Archivos en modo abierto (fotos, comprobantes, reportes).
create policy academia_open_mode_read on storage.objects for select to anon
  using (bucket_id in ('academia-photos','academia-receipts','academia-reports') and academia.open_mode());
create policy academia_open_mode_insert on storage.objects for insert to anon
  with check (bucket_id in ('academia-photos','academia-receipts','academia-reports') and academia.open_mode());
create policy academia_open_mode_update on storage.objects for update to anon
  using (bucket_id in ('academia-photos','academia-receipts','academia-reports') and academia.open_mode());
create policy academia_open_mode_delete on storage.objects for delete to anon
  using (bucket_id in ('academia-photos','academia-receipts','academia-reports') and academia.open_mode());
