-- ATUALIZAÇÃO LEVE (08/11/2026). Só ACRESCENTA uma função de leitura: não muda tabelas, regras nem dados.
-- Pode rodar de novo.
--
-- Por quê: a cada 30 s o app baixava de novo TODAS as publicações (com Amém e comentários), mesmo sem
-- nada novo. Com 400 publicações seriam ~400 KB a cada 30 s por celular com o app aberto.
--
-- Como funciona: o app pergunta "mudou alguma coisa?" e o banco responde com uma impressão digital
-- (32 letras) do que a pessoa pode ver: publicações, Amém, comentários, jornadas, integrantes e perfis.
-- Se for igual à anterior, o app não baixa nada. A função roda com as permissões de quem pergunta
-- (security invoker), então cada pessoa só "enxerga" o que já podia ver.
--
-- Para desfazer: 8b-desfazer-atualizacao-leve.sql (o app volta a baixar tudo a cada 30 s, como antes)
begin;

create or replace function public.feed_version(p_challenges uuid[], p_groups uuid[])
returns text
language sql stable security invoker set search_path = ''
as $$
  select md5(concat_ws('|',
    (select string_agg(md5(row_to_json(k)::text), '' order by k.id) from public.checkins k where k.challenge_id = any(p_challenges)),
    (select string_agg(md5(row_to_json(l)::text), '' order by l.checkin_id, l.user_id) from public.likes l join public.checkins k on k.id = l.checkin_id where k.challenge_id = any(p_challenges)),
    (select string_agg(md5(row_to_json(c)::text), '' order by c.id) from public.comments c join public.checkins k on k.id = c.checkin_id where k.challenge_id = any(p_challenges)),
    (select string_agg(md5(row_to_json(h)::text), '' order by h.id) from public.challenges h where h.group_id = any(p_groups)),
    (select string_agg(md5(row_to_json(m)::text), '' order by m.group_id, m.user_id) from public.group_members m where m.group_id = any(p_groups)),
    (select string_agg(md5(row_to_json(p)::text), '' order by p.id) from public.profiles p
       where p.id in (select m.user_id from public.group_members m where m.group_id = any(p_groups)))
  ))
$$;
revoke all on function public.feed_version(uuid[], uuid[]) from public, anon;
grant execute on function public.feed_version(uuid[], uuid[]) to authenticated;

commit;
