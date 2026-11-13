-- A LÍDER CORRIGE O LIVRO E OS CAPÍTULOS DO PASSO DE QUALQUER PESSOA DA CARAVANA DELA (13/11/2026).
-- Só ACRESCENTA uma regra: cada pessoa continua editando os próprios passos, como antes. Pode rodar de novo.
--
-- Por quê: algumas participantes marcam os capítulos errados e a líder precisa corrigir sem
-- depender de mais ninguém. No app: ✏️ Corrigir no post (ou no passo, pelo nome da pessoa).
-- A líder só muda livro, capítulos e a contagem; reflexão, fotos, data e tempo de estudo
-- continuam sendo só da dona do passo (a trava abaixo recusa qualquer outra mudança).
--
-- Para desfazer: 11b-desfazer-lider-corrige-passo.sql
drop policy if exists ck_update_leader on public.checkins;
create policy ck_update_leader on public.checkins for update to authenticated
  using (private.is_leader(private.challenge_group(challenge_id)))
  with check (private.is_leader(private.challenge_group(challenge_id)));

create or replace function private.ck_guard_leader() returns trigger
language plpgsql set search_path to '' as $$
begin
  -- quem edita o próprio passo (ou o painel do Supabase, sem usuário) muda o que quiser
  if (select auth.uid()) is null or (select auth.uid()) = old.user_id then return new; end if;
  if (new.user_id, new.challenge_id, new.read_date, new.note, new.photo_path, new.media_type,
      new.media_source, new.study_minutes, new.created_at)
     is distinct from
     (old.user_id, old.challenge_id, old.read_date, old.note, old.photo_path, old.media_type,
      old.media_source, old.study_minutes, old.created_at) then
    raise exception 'A líder só pode corrigir o livro e os capítulos do passo de outra pessoa.';
  end if;
  return new;
end $$;

drop trigger if exists ck_guard_leader on public.checkins;
create trigger ck_guard_leader before update on public.checkins
  for each row execute function private.ck_guard_leader();
