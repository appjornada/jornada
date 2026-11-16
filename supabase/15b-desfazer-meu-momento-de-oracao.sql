-- DESFAZER o 15-meu-momento-de-oracao.sql: apaga as orações individuais e os compartilhamentos.
-- ATENÇÃO: o histórico de "Meu momento de oração" de todos some. Nada mais é tocado.
-- Volte também o index.html para a versão anterior.
drop table if exists public.prayer_shares;
drop table if exists public.prayer_sessions;
drop function if exists private.psh_regras();
drop function if exists private.ps_regras();
