-- DESFAZER o 14-terminar-oracao.sql (volta ao comportamento do 13: Orar só renova o horário).
create or replace function private.pi_hora_do_servidor() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.prayed_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end $$;
revoke update on public.prayer_intercessions from authenticated;
grant update (prayed_at) on public.prayer_intercessions to authenticated;
alter table public.prayer_intercessions drop column if exists praying;
