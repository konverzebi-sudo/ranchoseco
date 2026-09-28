-- =====================================================================
-- Almacenamiento privado: fotos, comprobantes y reportes PDF.
-- Ruta de todos los archivos: <student_id>/<archivo>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photos',   'photos',   false, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('reports',  'reports',  false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create or replace function public.storage_student_id(object_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end $$;

-- Fotos: las ve quien puede ver al alumno; las sube el admin.
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.can_see_student(public.storage_student_id(name)));
create policy photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_admin());
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- Comprobantes: admin y padre del alumno.
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or public.parent_has_student(public.storage_student_id(name))));
create policy receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_admin());
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

-- Reportes: admin, profesor responsable y padre del alumno. Los generan admin/profesor.
create policy reports_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and public.can_see_student(public.storage_student_id(name)));
create policy reports_write on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and (public.is_admin() or public.coach_has_student(public.storage_student_id(name))));
create policy reports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and public.is_admin());
