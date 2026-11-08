-- DESFAZER o 6-so-a-lider-cria.sql: todo mundo volta a poder criar caravanas e jornadas.
-- Não apaga nenhuma caravana, jornada ou publicação. O app percebe sozinho e volta a mostrar os botões.
begin;
drop trigger if exists so_criadores on public.groups;
drop trigger if exists so_criadores on public.challenges;
drop function if exists private.so_criadores();
drop function if exists public.can_create();
drop function if exists private.is_creator();
drop table if exists private.criadores;
commit;
