-- DESFAZER o 12-mural-de-oracao.sql: apaga as tabelas do mural (pedidos, testemunhos e quem orou).
-- ATENÇÃO: os pedidos escritos no mural somem. Os pedidos antigos do chat continuam nas mensagens.
-- Volte também o index.html para a versão anterior ao mural.
drop table if exists public.prayer_intercessions;
drop table if exists public.prayer_requests;
