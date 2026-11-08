-- SÓ A LÍDER CRIA CARAVANAS E JORNADAS (07/11/2026). Só ACRESCENTA: não muda nenhuma regra existente
-- e não apaga nada. Pode rodar de novo.
--
-- Por quê: qualquer pessoa conseguia criar uma caravana nova (e virava líder dela). Algumas pessoas
-- criaram caravanas sem querer em vez de entrar com o código de convite.
--
-- Como funciona: uma lista (private.criadores) diz quem pode criar. Um gatilho recusa a criação de
-- caravana ou jornada por quem não está na lista. Entrar com código, publicar, editar e excluir
-- continuam como antes. Pelo SQL Editor (sem usuário logado) continua sendo possível criar.
--
-- Para liberar outra pessoa:
--   insert into private.criadores (user_id, nome) select id, 'Nome' from auth.users where email = 'email@exemplo.com';
-- Para tirar:
--   delete from private.criadores where nome = 'Nome';
-- Para desfazer tudo: 6b-desfazer-so-a-lider-cria.sql
begin;

create table if not exists private.criadores (
  user_id uuid primary key references auth.users on delete cascade,
  nome text,
  criado_em timestamptz default now()
);
alter table private.criadores enable row level security;
revoke all on private.criadores from public, anon, authenticated;

-- Mayara Martins (líder da caravana Tiago)
insert into private.criadores (user_id, nome)
select id, 'Mayara Martins' from auth.users where id = '9b3d254b-47e3-42cf-8494-ea72859e5052'
on conflict do nothing;

-- A pessoa logada pode criar?
create or replace function private.is_creator() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.criadores where user_id = (select auth.uid())) $$;
revoke all on function private.is_creator() from public, anon;
grant execute on function private.is_creator() to authenticated;

-- O app pergunta isto para mostrar ou esconder os botões de criar
create or replace function public.can_create() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_creator() $$;
revoke all on function public.can_create() from public, anon;
grant execute on function public.can_create() to authenticated;

-- Trava no banco: vale mesmo para versões antigas do app
create or replace function private.so_criadores() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin
  if (select auth.uid()) is not null and not private.is_creator() then
    raise exception 'Por enquanto, só a líder pode criar %. Peça o código de convite a ela.',
      case when tg_table_name = 'groups' then 'caravanas' else 'jornadas' end
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.so_criadores() from public, anon, authenticated;

drop trigger if exists so_criadores on public.groups;
create trigger so_criadores before insert on public.groups
  for each row execute function private.so_criadores();
drop trigger if exists so_criadores on public.challenges;
create trigger so_criadores before insert on public.challenges
  for each row execute function private.so_criadores();

commit;
