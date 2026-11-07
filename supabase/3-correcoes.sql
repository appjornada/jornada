-- CORREÇÕES DO BANCO (rode DEPOIS do 2-backup.sql). Só ACRESCENTA: nada é apagado. Pode rodar de novo.
-- Ajustado ao diagnóstico de 06/11/2026: as regras de acesso (RLS) já estão certas
-- (integrantes veem a caravana, publicação só em nome próprio, na própria caravana e dentro das datas).
-- Falta só isto:
begin;

-- 1) Publicação sem duplicar: o app manda uma "chave" única por tentativa. Se a internet cair
--    e a pessoa tentar de novo, o banco reconhece a mesma publicação e não grava outra.
alter table public.checkins add column if not exists client_key text;
create unique index if not exists checkins_user_client_key on public.checkins(user_id, client_key) where client_key is not null;

-- 2) Mural mais rápido: índice para buscar as publicações de cada jornada, das mais novas para as mais antigas.
create index if not exists checkins_challenge_created on public.checkins(challenge_id, created_at desc);

-- 3) Tempo de estudo válido (1 a 600 minutos). NOT VALID: vale só para registros novos.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checkins_minutos_validos') then
    alter table public.checkins add constraint checkins_minutos_validos
      check (study_minutes is null or study_minutes between 1 and 600) not valid;
  end if;
end $$;

commit;
select 'correções aplicadas' as resultado;
