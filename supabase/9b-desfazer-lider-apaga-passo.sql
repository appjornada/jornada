-- DESFAZER o 9-lider-apaga-passo.sql: a líder volta a apagar só os próprios passos.
drop policy if exists ck_delete_leader on public.checkins;
