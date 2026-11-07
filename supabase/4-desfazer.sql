-- DESFAZER o 3-correcoes.sql. Não apaga nenhuma publicação.
begin;
alter table public.checkins drop constraint if exists checkins_minutos_validos;
drop index if exists public.checkins_challenge_created;
drop index if exists public.checkins_user_client_key;
alter table public.checkins drop column if exists client_key;
commit;
