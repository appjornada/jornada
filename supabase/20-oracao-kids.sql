-- ORAÇÃO EM FAMÍLIA NA JORNADA KIDS (22/11/2026). Só ACRESCENTA; nada é apagado. Pode rodar de novo.
-- Cada registro: quem orou, em que jornada, o dia, o momento (ao acordar, na refeição, no caminho,
-- antes de dormir, outro) e com quais crianças. Sem duração. Só quem está na caravana vê;
-- cada pessoa só registra para si e só apaga as próprias orações.
-- Para desfazer: drop table if exists public.kids_prayers;

create table if not exists public.kids_prayers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  challenge_id uuid not null references public.challenges on delete cascade,
  prayed_on    date not null,
  moment       text not null check (moment in ('acordar','refeicao','caminho','dormir','outro')),
  child_names  text[] check (child_names is null or (cardinality(child_names) between 1 and 10 and length(array_to_string(child_names, ',')) <= 300)),
  created_at   timestamptz not null default now()
);
create index if not exists kids_prayers_challenge_idx on public.kids_prayers (challenge_id, created_at desc);
create index if not exists kids_prayers_user_idx on public.kids_prayers (user_id);

alter table public.kids_prayers enable row level security;
drop policy if exists kp_select on public.kids_prayers;
create policy kp_select on public.kids_prayers for select to authenticated
  using (private.is_member(private.challenge_group(challenge_id)));
drop policy if exists kp_insert on public.kids_prayers;
create policy kp_insert on public.kids_prayers for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member(private.challenge_group(challenge_id))
              and exists (select 1 from public.challenges c where c.id = challenge_id and prayed_on between c.start_date and c.end_date)
              and prayed_on <= current_date + 1);
drop policy if exists kp_delete on public.kids_prayers;
create policy kp_delete on public.kids_prayers for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.kids_prayers from anon, authenticated;
grant select, insert, delete on public.kids_prayers to authenticated;

notify pgrst, 'reload schema';
