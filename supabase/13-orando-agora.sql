-- ORANDO AGORA (15/11/2026). Mostra no mural quem está orando naquele momento.
-- Só ACRESCENTA a coluna prayed_at em prayer_intercessions (precisa do 12-mural-de-oracao.sql antes).
-- Pode rodar de novo sem problema.
--
-- prayed_at = última vez que a pessoa tocou em "Orar" (ou em "Estou orando de novo agora").
-- O app mostra "🟢 orando agora" por 5 minutos depois desse horário.
-- A hora é sempre a do servidor (gatilho abaixo): ninguém consegue ficar "orando agora" para sempre.
-- A pessoa só pode atualizar o próprio horário; não dá para mudar o pedido nem a pessoa.
--
-- Para desfazer: 13b-desfazer-orando-agora.sql

alter table public.prayer_intercessions add column if not exists prayed_at timestamptz;
update public.prayer_intercessions set prayed_at = created_at where prayed_at is null; -- os antigos não aparecem como "agora"
alter table public.prayer_intercessions alter column prayed_at set default now();
alter table public.prayer_intercessions alter column prayed_at set not null;

create or replace function private.pi_hora_do_servidor() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.prayed_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists pi_hora on public.prayer_intercessions;
create trigger pi_hora before insert or update on public.prayer_intercessions
  for each row execute function private.pi_hora_do_servidor();

drop policy if exists pi_update on public.prayer_intercessions;
create policy pi_update on public.prayer_intercessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.prayer_intercessions from authenticated;
grant update (prayed_at) on public.prayer_intercessions to authenticated;
