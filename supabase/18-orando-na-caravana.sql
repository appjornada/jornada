-- ORANDO NA CARAVANA (18/11/2026). Só ACRESCENTA; nada é apagado. Pode rodar de novo.
--
-- Para o Início mostrar "🟢 Ana está orando agora" enquanto a pessoa ora (e não só depois que termina):
-- 1) prayer_shares.ended_at: hora em que a oração avisada terminou (vazio = ainda orando).
-- 2) O aviso pode ser feito já no começo da oração (antes, só com a oração concluída).
--    Continua valendo: só a própria pessoa avisa, só da oração dela, só para caravana em que ela está.
--    O horário vem sempre da oração gravada (nunca do aparelho). A duração não vai para o aviso.
-- 3) Quando a pessoa encerra (ou corrige a hora do fim), o aviso recebe a hora do fim sozinho.
--    Ninguém consegue alterar o aviso diretamente: só a função do banco.
-- 4) Os avisos que já existem recebem a hora do fim das orações deles.
--
-- Sem este script o app continua funcionando: o aviso sai quando a pessoa encerra a oração.
-- Para desfazer: 18b-desfazer-orando-na-caravana.sql

-- 1
alter table public.prayer_shares add column if not exists ended_at timestamptz;
create index if not exists prayer_shares_group_started_idx on public.prayer_shares (group_id, started_at desc);

-- 2
create or replace function private.psh_regras() returns trigger
language plpgsql set search_path = '' as $$
declare s record;
begin
  select ps.started_at, ps.ended_at into s from public.prayer_sessions ps
   where ps.id = new.session_id and ps.user_id = (select auth.uid());
  if not found then
    raise exception 'Só dá para compartilhar uma oração sua.' using errcode = '42501';
  end if;
  new.user_id := (select auth.uid()); new.started_at := s.started_at; new.ended_at := s.ended_at; new.created_at := now();
  return new;
end $$;

-- 3
create or replace function private.psh_fim() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.prayer_shares set ended_at = new.ended_at where session_id = new.id;
  return null;
end $$;
revoke all on function private.psh_fim() from public, anon, authenticated;
drop trigger if exists psh_fim on public.prayer_sessions;
create trigger psh_fim after update of status, ended_at on public.prayer_sessions
  for each row execute function private.psh_fim();

-- 4
update public.prayer_shares sh set ended_at = ps.ended_at
  from public.prayer_sessions ps
 where ps.id = sh.session_id and sh.ended_at is distinct from ps.ended_at;

-- conferência: quantos avisos existem e quantos estão "orando agora"
select count(*) as avisos, count(*) filter (where ended_at is null) as orando_agora from public.prayer_shares;
