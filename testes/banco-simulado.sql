-- Reconstrução do banco para testes LOCAIS (nunca rodar no Supabase).
-- Deduzida das consultas do app; imita o Supabase: auth.uid(), papéis anon/authenticated, RLS e storage.
create extension if not exists pgcrypto;
do $$begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end$$;
create schema if not exists auth; create schema if not exists storage;
create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), unique(bucket_id,name));
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;

create table public.profiles(id uuid primary key references auth.users on delete cascade, name text, phone text);
create table public.groups(id uuid primary key default gen_random_uuid(), name text not null, invite_code text unique not null default upper(substr(md5(random()::text),1,6)), created_by uuid default auth.uid(), created_at timestamptz default now());
create table public.group_members(group_id uuid references public.groups on delete cascade, user_id uuid references auth.users on delete cascade, role text not null default 'member', joined_at timestamptz default now(), primary key(group_id,user_id));
create table public.challenges(id uuid primary key default gen_random_uuid(), group_id uuid references public.groups on delete cascade, name text not null, description text, start_date date not null, end_date date not null, goal_per_week int default 5, created_by uuid default auth.uid(), created_at timestamptz default now());
create table public.checkins(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, challenge_id uuid references public.challenges on delete cascade, read_date date not null, book text, ref text, chapters int, note text, photo_path text, media_type text, media_source text, study_minutes int, created_at timestamptz default now());
create table public.likes(checkin_id uuid references public.checkins on delete cascade, user_id uuid not null default auth.uid(), primary key(checkin_id,user_id));
create table public.comments(id uuid primary key default gen_random_uuid(), checkin_id uuid references public.checkins on delete cascade, user_id uuid not null default auth.uid(), body text not null, created_at timestamptz default now());
create table public.messages(id uuid primary key default gen_random_uuid(), challenge_id uuid references public.challenges on delete cascade, user_id uuid not null default auth.uid(), body text not null, created_at timestamptz default now());

-- funções e regras conforme o diagnóstico do banco real (supabase/1-diagnostico.sql, 06/11/2026)
create schema if not exists private;
create or replace function private.is_member(g uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from group_members where group_id=g and user_id=auth.uid()) $$;
create or replace function private.is_leader(g uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from group_members where group_id=g and user_id=auth.uid() and role='leader') $$;
create or replace function private.challenge_group(c uuid) returns uuid language sql stable security definer set search_path=public as $$ select group_id from challenges where id=c $$;
create or replace function private.checkin_group(k uuid) returns uuid language sql stable security definer set search_path=public as $$ select c.group_id from checkins x join challenges c on c.id=x.challenge_id where x.id=k $$;
create or replace function public.create_group(p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare g uuid; begin insert into groups(name,created_by) values(trim(p_name),auth.uid()) returning id into g; insert into group_members(group_id,user_id,role) values(g,auth.uid(),'leader'); return g; end $$;
create or replace function public.join_group(p_code text) returns uuid language plpgsql security definer set search_path=public as $$
declare g uuid; begin select id into g from groups where invite_code=upper(trim(p_code)); if g is null then raise exception 'Código de convite inválido'; end if;
insert into group_members(group_id,user_id) values(g,auth.uid()) on conflict do nothing; return g; end $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,name) values(new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),'Participante')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
alter table public.checkins add constraint checkins_chapters_check check (chapters between 1 and 200);

alter table public.profiles enable row level security; alter table public.groups enable row level security; alter table public.group_members enable row level security;
alter table public.challenges enable row level security; alter table public.checkins enable row level security; alter table public.likes enable row level security;
alter table public.comments enable row level security; alter table public.messages enable row level security; alter table storage.objects enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from public.group_members a join public.group_members b on a.group_id=b.group_id where a.user_id=profiles.id and b.user_id=auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy groups_select on public.groups for select to authenticated using (private.is_member(id));
create policy groups_update on public.groups for update to authenticated using (private.is_leader(id)) with check (private.is_leader(id));
create policy gm_select on public.group_members for select to authenticated using (private.is_member(group_id));
create policy gm_delete on public.group_members for delete to authenticated using (user_id=auth.uid() or private.is_leader(group_id));
create policy ch_select on public.challenges for select to authenticated using (private.is_member(group_id));
create policy ch_insert on public.challenges for insert to authenticated with check (private.is_leader(group_id));
create policy ch_update on public.challenges for update to authenticated using (private.is_leader(group_id)) with check (private.is_leader(group_id));
create policy ch_delete on public.challenges for delete to authenticated using (private.is_leader(group_id));
create policy ck_select on public.checkins for select to authenticated using (private.is_member(private.challenge_group(challenge_id)));
create policy ck_insert on public.checkins for insert to authenticated with check (user_id=auth.uid() and private.is_member(private.challenge_group(challenge_id)) and exists(select 1 from public.challenges c where c.id=checkins.challenge_id and checkins.read_date between c.start_date and c.end_date));
create policy ck_update on public.checkins for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy ck_delete on public.checkins for delete to authenticated using (user_id=auth.uid());
create policy lk_select on public.likes for select to authenticated using (private.is_member(private.checkin_group(checkin_id)));
create policy lk_insert on public.likes for insert to authenticated with check (user_id=auth.uid() and private.is_member(private.checkin_group(checkin_id)));
create policy lk_delete on public.likes for delete to authenticated using (user_id=auth.uid());
create policy cm_select on public.comments for select to authenticated using (exists(select 1 from public.checkins k where k.id=checkin_id and private.is_member(private.challenge_group(k.challenge_id))));
create policy cm_insert on public.comments for insert to authenticated with check (user_id=auth.uid());
create policy ms_select on public.messages for select to authenticated using (private.is_member(private.challenge_group(challenge_id)));
create policy ms_insert on public.messages for insert to authenticated with check (user_id=auth.uid() and private.is_member(private.challenge_group(challenge_id)));
create policy photos_select on storage.objects for select to authenticated using (bucket_id='photos');
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id='photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id='photos' and (storage.foldername(name))[1]=auth.uid()::text);
grant usage on schema public, auth, storage, private to authenticated, anon;
grant all on all tables in schema public to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
grant execute on all functions in schema public, auth, storage, private to authenticated;
