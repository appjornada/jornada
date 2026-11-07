-- DIAGNÓSTICO (somente leitura: não altera nada)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- O resultado é uma tabela única. Copie e cole o resultado na conversa.
with
cols as (
  select 'coluna' tipo, table_name objeto,
         string_agg(column_name||' '||data_type||coalesce(' default '||column_default,''), ' | ' order by ordinal_position) detalhe
  from information_schema.columns
  where table_schema='public'
  group by table_name
),
rls as (
  select 'rls' tipo, relname objeto, case when relrowsecurity then 'RLS ligado' else 'RLS DESLIGADO' end detalhe
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
),
pol as (
  select 'regra' tipo, schemaname||'.'||tablename objeto,
         policyname||' ['||cmd||', '||permissive||'] using: '||coalesce(qual,'-')||' | check: '||coalesce(with_check,'-') detalhe
  from pg_policies where schemaname in ('public','storage')
),
fn as (
  select 'funcao' tipo, p.proname objeto,
         case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end||' | '||pg_get_function_arguments(p.oid)||' | '||left(regexp_replace(p.prosrc,'\s+',' ','g'),700) detalhe
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
),
cons as (
  select 'restricao' tipo, conrelid::regclass::text objeto, conname||': '||pg_get_constraintdef(oid) detalhe
  from pg_constraint where connamespace='public'::regnamespace
),
trg as (
  select 'gatilho' tipo, event_object_table objeto, trigger_name||' '||action_timing||' '||event_manipulation||' -> '||action_statement detalhe
  from information_schema.triggers where trigger_schema in ('public','auth')
),
num as (
  select 'contagem' tipo, 'totais' objeto,
    'usuarios='||(select count(*) from auth.users)||
    ' perfis='||(select count(*) from public.profiles)||
    ' caravanas='||(select count(*) from public.groups)||
    ' vinculos='||(select count(*) from public.group_members)||
    ' jornadas='||(select count(*) from public.challenges)||
    ' publicacoes='||(select count(*) from public.checkins)||
    ' fotos='||(select count(*) from storage.objects where bucket_id='photos') detalhe
),
sem_vinculo as (
  -- publicações de pessoas que NÃO estão na caravana da jornada (ficam invisíveis para a própria pessoa)
  select 'alerta' tipo, 'publicacao sem vinculo' objeto, count(*)::text detalhe
  from public.checkins k join public.challenges c on c.id=k.challenge_id
  where not exists (select 1 from public.group_members m where m.group_id=c.group_id and m.user_id=k.user_id)
),
sem_perfil as (
  select 'alerta' tipo, 'usuario sem perfil' objeto, count(*)::text detalhe
  from auth.users u where not exists (select 1 from public.profiles p where p.id=u.id)
),
dup as (
  select 'alerta' tipo, 'vinculo duplicado' objeto, count(*)::text detalhe from (
    select group_id,user_id from public.group_members group by 1,2 having count(*)>1) x
),
sem_conf as (
  select 'alerta' tipo, 'e-mail nao confirmado' objeto, count(*)::text detalhe
  from auth.users where email_confirmed_at is null
)
select * from cols union all select * from rls union all select * from pol union all select * from fn
union all select * from cons union all select * from trg union all select * from num
union all select * from sem_vinculo union all select * from sem_perfil union all select * from dup union all select * from sem_conf
order by 1,2;
