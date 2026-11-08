-- DESFAZER o 7-foto-de-perfil.sql: o app volta a mostrar só a letra do nome.
-- Não apaga nenhuma publicação. Os arquivos das fotos de perfil continuam no armazenamento.
begin;
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles drop column if exists avatar_path;
commit;
