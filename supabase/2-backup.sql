-- BACKUP antes das correções (só copia; não altera nada do app)
-- Cria uma cópia de cada tabela no esquema "backup_20261106". Para conferir: select count(*) from backup_20261106.checkins;
create schema if not exists backup_20261106;
create table if not exists backup_20261106.profiles      as table public.profiles;
create table if not exists backup_20261106.groups        as table public.groups;
create table if not exists backup_20261106.group_members as table public.group_members;
create table if not exists backup_20261106.challenges    as table public.challenges;
create table if not exists backup_20261106.checkins      as table public.checkins;
create table if not exists backup_20261106.likes         as table public.likes;
create table if not exists backup_20261106.comments      as table public.comments;
create table if not exists backup_20261106.messages      as table public.messages;
-- o esquema de backup fica invisível para o app (não é exposto pela API)
revoke all on schema backup_20261106 from anon, authenticated;
select 'backup ok' as resultado,
  (select count(*) from backup_20261106.checkins) as publicacoes,
  (select count(*) from backup_20261106.group_members) as vinculos;
