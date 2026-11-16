-- MENOS CONSUMO (16/11/2026), a partir da auditoria de consumo. Só ACRESCENTA; nada é apagado. Pode rodar de novo.
--
-- 1) checkins.client_key: o app já mandava essa chave em toda publicação, mas a coluna nunca foi criada no
--    banco real. Cada envio era recusado (erro 400) e reenviado sem ela (19 de 39 envios num dia), e a
--    proteção contra publicação duplicada por essa chave não funcionava. Mesmo índice do 3-correcoes.sql.
-- 2) checkins.updated_at: hora da última mudança da publicação, inclusive Amém e comentários nela.
--    Assim o app baixa só as publicações que mudaram, em vez de todas, a cada Amém ou comentário de alguém.
--    O carimbo de Amém/comentário é posto por uma função do banco (as regras de quem pode editar o passo
--    continuam iguais: ela só mexe nessa coluna).
-- 3) pray_version(): impressão digital (32 letras) do mural de oração que a pessoa pode ver. O app só baixa
--    os pedidos quando ela muda. Roda com as permissões de quem pergunta (security invoker).
--
-- 4) limite por arquivo no armazenamento: 16 MB (era 50 MB). O app já recusa acima de 15 MB (áudio) e 4 MB (vídeo);
--    agora o servidor também, para versões antigas do app ou envios por fora.
--
-- Para desfazer: 17b-desfazer-consumo.sql

-- 1
alter table public.checkins add column if not exists client_key text;
create unique index if not exists checkins_user_client_key on public.checkins(user_id, client_key) where client_key is not null;

-- 2
alter table public.checkins add column if not exists updated_at timestamptz not null default now();
create index if not exists checkins_challenge_updated_idx on public.checkins(challenge_id, updated_at);

create or replace function private.ck_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ck_updated_at on public.checkins;
create trigger ck_updated_at before update on public.checkins
  for each row execute function private.ck_updated_at();

create or replace function private.ck_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.checkins set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.checkin_id else new.checkin_id end;
  return null;
end $$;
revoke all on function private.ck_touch() from public, anon, authenticated;
drop trigger if exists likes_touch on public.likes;
create trigger likes_touch after insert or delete on public.likes
  for each row execute function private.ck_touch();
drop trigger if exists comments_touch on public.comments;
create trigger comments_touch after insert or update or delete on public.comments
  for each row execute function private.ck_touch();

-- 3
create or replace function public.pray_version()
returns text
language sql stable security invoker set search_path = ''
as $$
  select md5(concat_ws('|',
    (select string_agg(md5(row_to_json(r)::text), '' order by r.id) from public.prayer_requests r),
    (select string_agg(md5(row_to_json(i)::text), '' order by i.request_id, i.user_id) from public.prayer_intercessions i)
  ))
$$;
revoke all on function public.pray_version() from public, anon;
grant execute on function public.pray_version() to authenticated;

-- 4
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 16777216 where id = 'photos' and (file_size_limit is null or file_size_limit > 16777216);
  end if;
end $$;
