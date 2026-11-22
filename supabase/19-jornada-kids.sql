-- JORNADA KIDS (22/11/2026). Já aplicado no banco em 22/11/2026 com autorização do Roger (início ajustado para 22/11 a pedido dele).
-- Só ACRESCENTA; nada é apagado.
--
-- 1) checkins.child_names: nomes das crianças que estudaram com o pai/mãe (publicações da Jornada Kids).
--    Vazio nas publicações de leitura. Visível só para quem está na caravana (mesmas regras das publicações).
-- 2) Caravana "Jornada Kids" (líderes: Roger e Mayara) e a jornada "Jornada Kids" (marcada com [kids]:
--    sem leitura do dia; o app mostra o registro de estudo com os filhos).

alter table public.checkins add column if not exists child_names text[];
do $$ begin
  if not exists (select 1 from pg_constraint where conname='checkins_child_names_check') then
    alter table public.checkins add constraint checkins_child_names_check
      check (child_names is null or (cardinality(child_names) between 1 and 10 and length(array_to_string(child_names, ',')) <= 300));
  end if;
end $$;

-- caravana e jornada (só cria se ainda não existir)
with g as (
  insert into public.groups(name, created_by)
  select 'Jornada Kids', '392047ee-6e1e-442e-82df-fbc0c26a310c'
  where not exists (select 1 from public.groups where name='Jornada Kids')
  returning id
), m as (
  insert into public.group_members(group_id, user_id, role)
  select g.id, u, 'leader' from g, unnest(array['392047ee-6e1e-442e-82df-fbc0c26a310c','9b3d254b-47e3-42cf-8494-ea72859e5052']::uuid[]) u
  returning group_id
)
insert into public.challenges(group_id, name, description, start_date, end_date, goal_per_week, created_by)
select g.id, 'Jornada Kids', 'Estudo da Palavra em família, no ritmo de cada criança. [kids]', '2026-11-22', '2027-12-31', 5, '392047ee-6e1e-442e-82df-fbc0c26a310c' from g;

notify pgrst, 'reload schema';

-- Para desfazer (apaga a caravana Kids e tudo dentro dela; só se ninguém tiver usado):
--   delete from public.groups where name='Jornada Kids';
--   alter table public.checkins drop constraint if exists checkins_child_names_check;
--   alter table public.checkins drop column if exists child_names;
