-- A LÍDER APAGA PASSO DE QUALQUER PESSOA DA CARAVANA DELA (08/11/2026). Só ACRESCENTA uma regra:
-- cada pessoa continua apagando os próprios passos, como antes. Pode rodar de novo.
--
-- Por quê: às vezes alguém registra um capítulo que ainda não é da jornada, e a líder precisa
-- corrigir sem depender de mais ninguém. No app: toque no nome da pessoa › 🗑️ no passo.
-- Ao apagar, os Amém e comentários daquele passo também somem (já era assim).
--
-- Para desfazer: 9b-desfazer-lider-apaga-passo.sql
drop policy if exists ck_delete_leader on public.checkins;
create policy ck_delete_leader on public.checkins for delete to authenticated
  using (private.is_leader(private.challenge_group(challenge_id)));
