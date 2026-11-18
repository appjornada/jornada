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
-- 5) CORRIGIR o tempo de uma oração já registrada (quem esqueceu o cronômetro ligado): função ps_corrigir.
--    Só a própria pessoa (as regras de acesso continuam valendo), só oração concluída, só a hora do fim:
--    o início não muda, o fim fica depois do início, nunca no futuro e com no máximo 24 h.
--    Fora dessa função, oração concluída continua sem mudar (encerrar de novo em outro aparelho: fica o primeiro).
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

-- 5
create or replace function private.ps_regras() returns trigger
language plpgsql set search_path = '' as $$
declare agora timestamptz := date_trunc('second', now());
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.user_id := old.user_id; new.started_at := old.started_at; new.created_at := old.created_at;
    if old.status = 'done' then
      if coalesce(current_setting('jornada.corrigir', true), '') = '1' and new.ended_at is not null then
        new.status := 'done';                                                          -- correção (ps_corrigir): só o fim
      else
        new.status := 'done'; new.ended_at := old.ended_at; new.updated_at := old.updated_at;  -- encerrar de novo: fica o primeiro
        return new;
      end if;
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

create or replace function public.ps_corrigir(p_id uuid, p_fim timestamptz)
returns setof public.prayer_sessions
language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('jornada.corrigir', '1', true);
  return query update public.prayer_sessions s set ended_at = p_fim
                where s.id = p_id and s.status = 'done' returning s.*;
  perform set_config('jornada.corrigir', '', true);
end $$;
revoke all on function public.ps_corrigir(uuid, timestamptz) from public, anon;
grant execute on function public.ps_corrigir(uuid, timestamptz) to authenticated;

-- conferência: quantos avisos existem e quantos estão "orando agora"
select count(*) as avisos, count(*) filter (where ended_at is null) as orando_agora from public.prayer_shares;
