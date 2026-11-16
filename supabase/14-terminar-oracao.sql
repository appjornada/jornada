-- TERMINAR A ORAÇÃO (15/11/2026). Precisa do 13-orando-agora.sql antes. Pode rodar de novo.
--
-- praying = a pessoa ainda está orando agora (botão "Orando").
--   Tocar em Orar   → praying = true  e prayed_at = agora (hora do servidor)
--   Tocar de novo   → praying = false (o botão volta para "Orar de novo")
-- A linha continua existindo: quem orou SEMPRE fica no contador.
--
-- Para desfazer: 14b-desfazer-terminar-oracao.sql

alter table public.prayer_intercessions add column if not exists praying boolean;
update public.prayer_intercessions set praying = (prayed_at > now() - interval '5 minutes') where praying is null;
alter table public.prayer_intercessions alter column praying set default true;
alter table public.prayer_intercessions alter column praying set not null;

create or replace function private.pi_hora_do_servidor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.prayed_at := now(); new.created_at := now(); new.praying := true;
  elsif new.praying then
    new.prayed_at := now();            -- começou (ou continua) a orar
  else
    new.prayed_at := old.prayed_at;    -- terminou: guarda a hora em que orou
  end if;
  return new;
end $$;

revoke update on public.prayer_intercessions from authenticated;
grant update (prayed_at, praying) on public.prayer_intercessions to authenticated;
