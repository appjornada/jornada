-- DESFAZER o 11-lider-corrige-passo.sql: a líder volta a editar só os próprios passos.
drop policy if exists ck_update_leader on public.checkins;
drop trigger if exists ck_guard_leader on public.checkins;
drop function if exists private.ck_guard_leader();
