-- FOTO DE PERFIL (08/11/2026). Só ACRESCENTA um campo ao perfil: não muda nenhuma regra existente
-- e não apaga nada. Pode rodar de novo.
--
-- Como funciona: a foto fica no mesmo lugar das fotos das publicações (bucket "photos", na pasta da
-- própria pessoa), com o nome <id>/avatar-<código>.jpg. O perfil guarda só o caminho.
-- As regras que já existem continuam valendo: cada pessoa só muda o próprio perfil, só envia fotos
-- para a própria pasta, e só quem está na mesma caravana vê o perfil.
-- A trava abaixo garante que o caminho aponte para uma foto de perfil da própria pessoa.
--
-- Para desfazer: 7b-desfazer-foto-de-perfil.sql
begin;

alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (avatar_path is null or avatar_path ~ ('^' || id::text || '/avatar-[0-9a-f]{8,40}\.jpg$'));

commit;
