-- INVESTIGAÇÃO (somente leitura): por que há fotos guardadas sem publicação?
-- Mostra, em ordem de data, as caravanas, jornadas, publicações e fotos.
-- Uma foto "SEM publicação" criada ANTES de uma jornada ser criada indica que a publicação
-- foi apagada junto com uma jornada excluída; criada DEPOIS indica que a gravação falhou.
-- Copie o resultado e cole na conversa.
select * from (
  select 'caravana' tipo, g.created_at quando, coalesce(p.name,'?') pessoa, g.name descricao,
         (select count(*) from public.group_members m where m.group_id = g.id)::text || ' integrantes' situacao
  from public.groups g left join public.profiles p on p.id = g.created_by
  union all
  select 'jornada', c.created_at, coalesce(p.name,'?'), c.name || ' (' || c.start_date || ' a ' || c.end_date || ')', g.name
  from public.challenges c join public.groups g on g.id = c.group_id left join public.profiles p on p.id = c.created_by
  union all
  select 'publicacao', k.created_at, coalesce(p.name,'?'), k.read_date || ' · ' || coalesce(k.book,'') || ' ' || coalesce(k.ref,''),
         coalesce(k.photo_path,'(sem foto)')
  from public.checkins k left join public.profiles p on p.id = k.user_id
  union all
  select 'foto', o.created_at, coalesce(p.name,'?'), o.name,
         case when exists (select 1 from public.checkins k where k.photo_path like '%' || o.name || '%') then 'usada em publicação'
              when o.name like '%.t.jpg' then 'miniatura'
              else 'SEM publicação' end
  from storage.objects o left join public.profiles p on p.id::text = split_part(o.name, '/', 1)
  where o.bucket_id = 'photos'
) x order by quando;
