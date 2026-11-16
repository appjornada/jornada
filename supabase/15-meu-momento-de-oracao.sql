-- MEU MOMENTO DE ORAÇÃO (16/11/2026). Só ACRESCENTA duas tabelas novas; nada do que já existe muda.
-- Pode rodar de novo sem problema.
--
-- prayer_sessions → cada momento de oração individual (cronômetro "Começar a orar" / "Encerrar oração")
--   • PRIVADO: só a própria pessoa lê, cria, encerra ou apaga. Ninguém mais (nem a líder) enxerga
--     duração, totais ou dias sem oração. Não entra em ranking, mural, feed nem em nenhuma função.
--   • id criado no aparelho: repetir o envio (internet caiu no meio) não cria outra linha.
--   • status: 'active' (orando agora) ou 'done' (concluída). Descartar = apagar a linha.
--   • no máximo UMA oração em andamento por pessoa (índice prayer_sessions_um_ativo).
--   • horários guardados em segundos inteiros; duration_s = fim − início (regra única da duração).
--   • o servidor não aceita horário no futuro (troca pela hora do servidor), fim antes do início
--     nem oração com mais de 24 horas. Depois de concluída, a oração não muda mais
--     (encerrar de novo, de outro aparelho, mantém o primeiro registro).
--
-- prayer_shares → "Compartilhar este momento" (opcional, um toque por oração concluída)
--   • guarda só o necessário para a atividade: quem, qual caravana e o horário de INÍCIO.
--     Nada de duração, horário de término ou totais.
--   • a caravana vê (mesma regra do mural de oração: integrantes da caravana).
--   • só quem orou compartilha, só oração concluída, e só a própria pessoa remove.
--   • apagar a oração apaga junto o compartilhamento.
--
-- Para desfazer: 15b-desfazer-meu-momento-de-oracao.sql

create table if not exists public.prayer_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  status      text not null default 'active' check (status in ('active', 'done')),
  started_at  timestamptz not null,
  ended_at    timestamptz,
  duration_s  integer generated always as
                (case when ended_at is null then null else floor(extract(epoch from (ended_at - started_at)))::integer end) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint prayer_sessions_estado check ((status = 'active') = (ended_at is null)),
  constraint prayer_sessions_ordem  check (ended_at is null or ended_at > started_at),
  constraint prayer_sessions_maximo check (ended_at is null or ended_at - started_at <= interval '24 hours')
);
create unique index if not exists prayer_sessions_um_ativo on public.prayer_sessions (user_id) where status = 'active';
create index if not exists prayer_sessions_user_idx on public.prayer_sessions (user_id, started_at desc);

-- horários: segundos inteiros, nunca no futuro; oração concluída não muda mais
create or replace function private.ps_regras() returns trigger
language plpgsql set search_path = '' as $$
declare agora timestamptz := date_trunc('second', now());
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.user_id := old.user_id; new.started_at := old.started_at; new.created_at := old.created_at;
    if old.status = 'done' then
      new.status := 'done'; new.ended_at := old.ended_at; new.updated_at := old.updated_at;  -- encerrar de novo: fica o primeiro
      return new;
    end if;
  else
    new.created_at := now();
    new.started_at := date_trunc('second', new.started_at);
    if new.started_at > agora then new.started_at := agora; end if;                    -- relógio do celular adiantado
    if new.started_at < now() - interval '30 days' then
      raise exception 'Horário de início muito antigo.' using errcode = '23514';
    end if;
  end if;
  if new.ended_at is not null then
    new.ended_at := date_trunc('second', new.ended_at);
    if new.ended_at > agora then new.ended_at := agora; end if;                        -- término nunca no futuro
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ps_regras on public.prayer_sessions;
create trigger ps_regras before insert or update on public.prayer_sessions
  for each row execute function private.ps_regras();

alter table public.prayer_sessions enable row level security;
drop policy if exists ps_select on public.prayer_sessions;
create policy ps_select on public.prayer_sessions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ps_insert on public.prayer_sessions;
create policy ps_insert on public.prayer_sessions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists ps_update on public.prayer_sessions;
create policy ps_update on public.prayer_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists ps_delete on public.prayer_sessions;
create policy ps_delete on public.prayer_sessions for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.prayer_sessions from anon, authenticated;
grant select, insert, delete on public.prayer_sessions to authenticated;
grant update (status, ended_at) on public.prayer_sessions to authenticated;   -- só encerrar

-- compartilhamento
create table if not exists public.prayer_shares (
  session_id  uuid primary key references public.prayer_sessions on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  group_id    uuid not null references public.groups on delete cascade,
  started_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists prayer_shares_group_idx on public.prayer_shares (group_id, created_at desc);
create index if not exists prayer_shares_user_idx  on public.prayer_shares (user_id);

-- o horário vem da própria oração (não do aparelho), e só de oração concluída de quem compartilha
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
drop trigger if exists psh_regras on public.prayer_shares;
create trigger psh_regras before insert on public.prayer_shares
  for each row execute function private.psh_regras();

alter table public.prayer_shares enable row level security;
drop policy if exists psh_select on public.prayer_shares;
create policy psh_select on public.prayer_shares for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(group_id));
drop policy if exists psh_insert on public.prayer_shares;
create policy psh_insert on public.prayer_shares for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member(group_id));
drop policy if exists psh_delete on public.prayer_shares;
create policy psh_delete on public.prayer_shares for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.prayer_shares from anon, authenticated;
grant select, insert, delete on public.prayer_shares to authenticated;
