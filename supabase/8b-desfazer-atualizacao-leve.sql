-- DESFAZER o 8-atualizacao-leve.sql: o app percebe sozinho e volta a baixar tudo a cada 30 s, como antes.
drop function if exists public.feed_version(uuid[], uuid[]);
