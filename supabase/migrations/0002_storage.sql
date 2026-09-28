-- =====================================================================
-- Almacenamiento privado: fotos, comprobantes y reportes PDF.
-- Ruta de todos los archivos: <student_id>/<archivo>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('academia-photos',   'academia-photos',   false, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('academia-receipts', 'academia-receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('academia-reports',  'academia-reports',  false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create or replace function academia.storage_student_id(object_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end $$;

-- Fotos: las ve quien puede ver al alumno; las sube el admin.
create policy academia_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'academia-photos' and academia.can_see_student(academia.storage_student_id(name)));
create policy academia_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'academia-photos' and academia.is_admin());
create policy academia_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'academia-photos' and academia.is_admin());
create policy academia_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'academia-photos' and academia.is_admin());

-- Comprobantes: admin y padre del alumno.
create policy academia_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'academia-receipts' and (academia.is_admin() or academia.parent_has_student(academia.storage_student_id(name))));
create policy academia_receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'academia-receipts' and academia.is_admin());
create policy academia_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'academia-receipts' and academia.is_admin());

-- Reportes: admin, profesor responsable y padre del alumno. Los generan admin/profesor.
create policy academia_reports_read on storage.objects for select to authenticated
  using (bucket_id = 'academia-reports' and academia.can_see_student(academia.storage_student_id(name)));
create policy academia_reports_write on storage.objects for insert to authenticated
  with check (bucket_id = 'academia-reports' and (academia.is_admin() or academia.coach_has_student(academia.storage_student_id(name))));
create policy academia_reports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'academia-reports' and academia.is_admin());
