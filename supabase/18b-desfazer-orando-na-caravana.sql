-- DESFAZ o 18-orando-na-caravana.sql. Não apaga orações nem avisos.
-- Volta a regra antiga (avisar só oração concluída) e tira a coluna ended_at dos avisos.
-- Avisos de orações ainda em andamento continuam guardados (só deixam de aparecer como "orando agora").

drop trigger if exists psh_fim on public.prayer_sessions;
drop function if exists private.psh_fim();

create or replace function private.psh_regras() returns trigger
language plpgsql set search_path = '' as $$
declare s record;
begin
  select ps.started_at, ps.status into s from public.prayer_sessions ps
   where ps.id = new.session_id and ps.user_id = (select auth.uid());
  if not found or s.status <> 'done' then
    raise exception 'Só dá para compartilhar uma oração sua já concluída.' using errcode = '42501';
  end if;
  new.user_id := (select auth.uid()); new.started_at := s.started_at; new.created_at := now();
  return new;
end $$;

drop index if exists public.prayer_shares_group_started_idx;
alter table public.prayer_shares drop column if exists ended_at;
