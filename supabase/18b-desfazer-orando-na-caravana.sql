-- DESFAZ o 18-orando-na-caravana.sql. Não apaga orações nem avisos.
-- Volta as regras antigas (avisar só oração concluída; oração concluída não se corrige) e tira a coluna ended_at dos avisos.
-- As correções já feitas continuam valendo.
-- Avisos de orações ainda em andamento continuam guardados (só deixam de aparecer como "orando agora").

drop function if exists public.ps_corrigir(uuid, timestamptz);
-- volta a regra: oração concluída não muda mais
create or replace function private.ps_regras() returns trigger
language plpgsql set search_path = '' as $$
declare agora timestamptz := date_trunc('second', now());
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.user_id := old.user_id; new.started_at := old.started_at; new.created_at := old.created_at;
    if old.status = 'done' then
      new.status := 'done'; new.ended_at := old.ended_at; new.updated_at := old.updated_at;
      return new;
    end if;
  else
    new.created_at := now();
    new.started_at := date_trunc('second', new.started_at);
    if new.started_at > agora then new.started_at := agora; end if;
    if new.started_at < now() - interval '30 days' then
      raise exception 'Horário de início muito antigo.' using errcode = '23514';
    end if;
  end if;
  if new.ended_at is not null then
    new.ended_at := date_trunc('second', new.ended_at);
    if new.ended_at > agora then new.ended_at := agora; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

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
