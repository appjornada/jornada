-- DESFAZER o 13-orando-agora.sql (o mural continua; só some o "orando agora").
drop trigger if exists pi_hora on public.prayer_intercessions;
drop function if exists private.pi_hora_do_servidor();
drop policy if exists pi_update on public.prayer_intercessions;
revoke update on public.prayer_intercessions from authenticated;
alter table public.prayer_intercessions drop column if exists prayed_at;
