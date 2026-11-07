#!/bin/bash
# Testa os scripts de supabase/ num PostgreSQL local com as MESMAS regras do banco real
# (testes/banco-simulado.sql, montado a partir do diagnóstico de 06/11/2026).
# Uso: PGHOST=... PGPORT=... PGUSER=postgres bash testes/teste-banco.sh
set -e
cd "$(dirname "$0")/.."
DB=jornada_teste
export PGOPTIONS="-c client_min_messages=warning"
psql -q -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$P -f testes/banco-simulado.sql
ok(){ echo "  ✔ $1"; }
as(){ $P -At -c "set role authenticated; set request.jwt.claim.sub='$1'; $2"; }
fails(){ if as "$1" "$2" >/dev/null 2>&1; then echo "  ✘ deveria falhar: $3"; exit 1; else ok "$3"; fi }
novo(){ $P -At -c "insert into auth.users(email,raw_user_meta_data) values('$1@t','{\"name\":\"$2\"}') returning id"; }

L=$(novo lider Líder); U=(); for i in 1 2 3 4 5; do U+=($(novo p$i "Pessoa $i")); done; FORA=$(novo fora "De Fora")

echo "1) Caravana com 6 pessoas (regras reais)"
G=$(as $L "select public.create_group('Caravana Teste')"); COD=$($P -At -c "select invite_code from public.groups where id='$G'")
for id in "${U[@]}"; do as $id "select public.join_group('$COD')" >/dev/null; done; as ${U[0]} "select public.join_group('$COD')" >/dev/null
[ "$($P -At -c "select count(*) from public.group_members where group_id='$G'")" = 6 ] && ok "6 vínculos gravados, sem duplicar"
[ "$($P -At -c "select count(*) from public.profiles")" = 7 ] && ok "gatilho criou o perfil de todo mundo"
for id in $L "${U[@]}"; do n=$(as $id "select count(*) from public.group_members where group_id='$G'"); [ "$n" = 6 ] || { echo "  ✘ $id vê $n"; exit 1; }; done
ok "cada integrante já lê os 6 vínculos e os nomes (o app lê direto, sem função nova)"
[ "$(as ${U[2]} "select count(*) from public.profiles p join public.group_members m on m.user_id=p.id where m.group_id='$G'")" = 6 ] && ok "nomes dos 6 visíveis"
[ "$(as ${U[2]} "select count(*) from public.group_members")" = 6 ] && ok "a consulta antiga do app (sem filtro) devolve 6 linhas → repetia a caravana 6 vezes"
[ "$(as $FORA "select count(*) from public.group_members where group_id='$G'")" = 0 ] && ok "quem é de fora não vê ninguém"
C=$(as $L "insert into public.challenges(group_id,name,start_date,end_date) values('$G','Romanos',current_date-2,current_date+13) returning id")
G2=$(as $FORA "select public.create_group('Outra')"); C2=$(as $FORA "insert into public.challenges(group_id,name,start_date,end_date) values('$G2','João',current_date,current_date+20) returning id")

echo "2) Regras de publicação que já existem no banco"
fails ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C2',current_date,1,10)" "não publica em caravana alheia"
fails ${U[0]} "insert into public.checkins(user_id,challenge_id,read_date,chapters,study_minutes) values('${U[1]}','$C',current_date,1,10)" "não publica em nome de outra pessoa"
fails ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date+30,1,10)" "não publica fora das datas da jornada (o app agora explica isso)"
fails ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,500,10)" "500 capítulos recusado"

echo "3) Backup e correções (duas vezes)"
$P -f supabase/1-diagnostico.sql >/dev/null && ok "diagnóstico roda"
$P -f supabase/2-backup.sql >/dev/null && $P -f supabase/3-correcoes.sql >/dev/null && $P -f supabase/3-correcoes.sql >/dev/null && ok "backup e correções rodam (2x)"
[ "$($P -At -c "select count(*) from backup_20261106.group_members")" = 7 ] && ok "backup com os 7 vínculos"

echo "4) Depois das correções"
for i in 0 1 2 4; do (as ${U[$i]} "insert into public.checkins(challenge_id,read_date,book,ref,chapters,study_minutes,photo_path,client_key) values('$C',current_date,'Romanos','1',1,15,'${U[$i]}/a.jpg','k-$i')" >/dev/null) & done; wait
for id in $L ${U[0]} ${U[2]}; do [ "$(as $id "select count(*) from public.checkins where challenge_id='$C'")" = 4 ] || { echo "  ✘ $id"; exit 1; }; done
ok "4 publicações simultâneas gravadas e vistas por todos"
fails ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes,client_key) values('$C',current_date,1,15,'k-0')" "mesma tentativa (mesma chave) não duplica"
fails ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,0)" "0 minutos recusado"
as ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5)" >/dev/null && ok "5 minutos aceito"
as ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters) values('$C',current_date,1)" >/dev/null && ok "publicação sem chave (versão antiga do app) continua aceita"

echo "5) Saída da caravana (regra gm_delete já existente)"
n=$(as ${U[3]} "delete from public.group_members where group_id='$G' and user_id='${U[3]}' returning 1" | wc -l); [ "$n" = 1 ] && ok "participante sai"
[ "$(as $L "select count(*) from public.group_members where group_id='$G'")" = 5 ] && ok "contagem foi para 5"
n=$(as ${U[1]} "delete from public.group_members where group_id='$G' and user_id='${U[2]}' returning 1" | wc -l); [ "$n" = 0 ] && ok "não tira outra pessoa"
[ "$(as ${U[3]} "select count(*) from public.checkins where challenge_id='$C'")" = 0 ] && ok "quem saiu deixa de ver as publicações"

echo "6) Investigação e desfazer"
$P -f supabase/5-onde-estao-as-publicacoes.sql >/dev/null; ok "consulta de investigação roda"
N=$($P -At -c "select count(*) from public.checkins")
$P -f supabase/4-desfazer.sql >/dev/null && [ "$($P -At -c "select count(*) from public.checkins")" = "$N" ] && ok "desfazer não apaga publicações ($N)"
$P -f supabase/3-correcoes.sql >/dev/null && ok "correções aplicadas de novo"
echo "TODOS OS TESTES DO BANCO PASSARAM"
