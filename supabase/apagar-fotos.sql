-- Permite que cada pessoa apague as PRÓPRIAS fotos do armazenamento (bucket "photos").
-- O app guarda as fotos em photos/<id-do-usuário>/<arquivo>, então só a dona da pasta pode apagar.
-- Como usar: Supabase > SQL Editor > New query > cole este texto > Run.
drop policy if exists "Apagar as próprias fotos" on storage.objects;
create policy "Apagar as próprias fotos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
