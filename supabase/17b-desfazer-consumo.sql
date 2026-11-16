-- DESFAZER o 17-consumo.sql. Não apaga publicações, Amém nem comentários.
-- A coluna client_key fica (é do 3-correcoes.sql e o app usa); para tirá-la, use o 4-desfazer.sql.
drop function if exists public.pray_version();
drop trigger if exists likes_touch on public.likes;
drop trigger if exists comments_touch on public.comments;
drop function if exists private.ck_touch();
drop trigger if exists ck_updated_at on public.checkins;
drop function if exists private.ck_updated_at();
drop index if exists public.checkins_challenge_updated_idx;
alter table public.checkins drop column if exists updated_at;
do $$ begin
  if to_regclass('storage.buckets') is not null then update storage.buckets set file_size_limit = 52428800 where id = 'photos'; end if;
end $$;
