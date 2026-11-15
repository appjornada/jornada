-- MURAL DE ORAÇÃO (15/11/2026). Só ACRESCENTA duas tabelas novas; nada do que já existe muda.
-- Pode rodar de novo sem problema.
--
-- prayer_requests       → cada pedido de oração
--   • da caravana (is_private = false): todos da caravana veem e podem tocar em "Orar"
--   • pessoal     (is_private = true) : só quem escreveu vê (um caderno de oração)
--   • answered_at / testimony: quando o autor marca "Deus respondeu" e conta o testemunho
-- prayer_intercessions  → quem tocou em "Orar" em cada pedido (uma vez por pessoa)
--
-- Regras:
--   • escrever, editar, marcar como respondido e apagar: só o autor
--   • a líder da caravana também pode APAGAR pedidos da caravana (para tirar algo inadequado)
--   • "Orar": qualquer integrante da caravana, em pedido aberto de outra pessoa
--
-- Os pedidos antigos (que ficavam no chat com "🙏 Pedido de oração: ") são COPIADOS para o mural.
-- As mensagens antigas continuam no banco; o app só deixa de mostrá-las.
--
-- Para desfazer: 12b-desfazer-mural-de-oracao.sql

create table if not exists public.prayer_requests (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text check (title is null or char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 1500),
  is_private  boolean not null default false,
  answered_at timestamptz,
  testimony   text check (testimony is null or char_length(testimony) <= 1500),
  created_at  timestamptz not null default now(),
  constraint prayer_requests_grupo check (is_private or group_id is not null)
);
create index if not exists prayer_requests_group_idx on public.prayer_requests (group_id, created_at desc);
create index if not exists prayer_requests_user_idx  on public.prayer_requests (user_id, created_at desc);

create table if not exists public.prayer_intercessions (
  request_id uuid not null references public.prayer_requests on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index if not exists prayer_intercessions_user_idx on public.prayer_intercessions (user_id);

alter table public.prayer_requests      enable row level security;
alter table public.prayer_intercessions enable row level security;

-- pedidos
drop policy if exists pr_select on public.prayer_requests;
create policy pr_select on public.prayer_requests for select to authenticated
  using (user_id = (select auth.uid()) or (not is_private and private.is_member(group_id)));
drop policy if exists pr_insert on public.prayer_requests;
create policy pr_insert on public.prayer_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and (is_private or private.is_member(group_id)));
drop policy if exists pr_update on public.prayer_requests;
create policy pr_update on public.prayer_requests for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (is_private or private.is_member(group_id)));
drop policy if exists pr_delete on public.prayer_requests;
create policy pr_delete on public.prayer_requests for delete to authenticated
  using (user_id = (select auth.uid()) or (not is_private and private.is_leader(group_id)));

-- quem está orando
drop policy if exists pi_select on public.prayer_intercessions;
create policy pi_select on public.prayer_intercessions for select to authenticated
  using (exists (select 1 from public.prayer_requests r where r.id = request_id)); -- vê se vê o pedido
drop policy if exists pi_insert on public.prayer_intercessions;
create policy pi_insert on public.prayer_intercessions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.prayer_requests r
    where r.id = request_id and not r.is_private and r.answered_at is null
      and r.user_id <> (select auth.uid()) and private.is_member(r.group_id)));
drop policy if exists pi_delete on public.prayer_intercessions;
create policy pi_delete on public.prayer_intercessions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.prayer_requests, public.prayer_intercessions to authenticated;

-- copia os pedidos antigos do chat (uma vez só: não duplica se rodar de novo)
insert into public.prayer_requests (group_id, user_id, body, created_at)
select c.group_id, m.user_id, left(substr(m.body, char_length('🙏 Pedido de oração: ') + 1), 1500), m.created_at
from public.messages m join public.challenges c on c.id = m.challenge_id
where m.body like '🙏 Pedido de oração: %'
  and char_length(m.body) > char_length('🙏 Pedido de oração: ')
  and not exists (select 1 from public.prayer_requests r
                  where r.user_id = m.user_id and r.created_at = m.created_at and r.group_id = c.group_id);
