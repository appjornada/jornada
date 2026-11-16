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

echo "7) Só a líder cria caravanas e jornadas (6-so-a-lider-cria.sql)"
$P -f supabase/6-so-a-lider-cria.sql >/dev/null && $P -f supabase/6-so-a-lider-cria.sql >/dev/null && ok "script roda (2x)"
fails ${U[0]} "select public.create_group('Sem querer')" "participante não cria caravana"
fails $L "select public.create_group('Outra do líder')" "líder fora da lista também não cria caravana"
fails $L "insert into public.challenges(group_id,name,start_date,end_date) values('$G','Nova',current_date,current_date+5)" "líder fora da lista não cria jornada"
[ "$($P -At -c "select count(*) from public.groups where name in ('Sem querer','Outra do líder')")" = 0 ] && ok "nada ficou pela metade"
[ "$(as ${U[0]} "select public.can_create()")" = f ] && ok "app fica sabendo que a pessoa não pode criar"
$P -c "insert into private.criadores(user_id,nome) values('$L','Líder')" >/dev/null
[ "$(as $L "select public.can_create()")" = t ] && ok "pessoa da lista: app mostra os botões"
G3=$(as $L "select public.create_group('Caravana da líder')") && [ -n "$G3" ] && ok "pessoa da lista cria caravana"
as $L "insert into public.challenges(group_id,name,start_date,end_date) values('$G','Nova',current_date,current_date+5)" >/dev/null && ok "pessoa da lista cria jornada"
as ${U[4]} "select public.join_group('$COD')" >/dev/null && ok "entrar com código continua funcionando"
as ${U[0]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5)" >/dev/null && ok "publicar continua funcionando"
as $L "update public.challenges set name='Romanos!' where id='$C' returning 1" | grep -q 1 && ok "líder continua editando a jornada"
$P -c "insert into public.groups(name) values('Pelo SQL Editor')" >/dev/null && ok "pelo SQL Editor (sem login) continua criando"
fails ${U[0]} "select * from private.criadores" "ninguém lê a lista pelo app"
$P -f supabase/6b-desfazer-so-a-lider-cria.sql >/dev/null && as ${U[0]} "select public.create_group('Liberado')" >/dev/null && ok "desfazer libera de novo para todos"

echo "8) Foto de perfil (7-foto-de-perfil.sql)"
$P -f supabase/7-foto-de-perfil.sql >/dev/null && $P -f supabase/7-foto-de-perfil.sql >/dev/null && ok "script roda (2x)"
[ "$($P -At -c "select count(*) from public.profiles where avatar_path is not null")" = 0 ] && ok "perfis existentes continuam sem foto (nada mudou)"
A0="${U[0]}/avatar-0123456789abcdef.jpg"
as ${U[0]} "insert into storage.objects(bucket_id,name,owner) values('photos','$A0',auth.uid())" >/dev/null && ok "envia a foto para a própria pasta"
fails ${U[0]} "insert into storage.objects(bucket_id,name,owner) values('photos','${U[1]}/avatar-0123456789abcdef.jpg',auth.uid())" "não envia foto para a pasta de outra pessoa"
[ "$(as ${U[0]} "update public.profiles set avatar_path='$A0' where id=auth.uid() returning 1")" = 1 ] && ok "põe a própria foto no perfil"
fails ${U[0]} "update public.profiles set avatar_path='${U[1]}/avatar-0123456789abcdef.jpg' where id=auth.uid()" "não aponta para a foto de outra pessoa"
fails ${U[0]} "update public.profiles set avatar_path='${U[0]}/../x.jpg' where id=auth.uid()" "não aceita caminho estranho"
[ -z "$(as ${U[0]} "update public.profiles set avatar_path=null where id='${U[1]}' returning 1")" ] && ok "não muda o perfil de outra pessoa"
[ "$(as ${U[1]} "select avatar_path from public.profiles where id='${U[0]}'")" = "$A0" ] && ok "quem é da mesma caravana vê a foto"
[ -z "$(as $FORA "select avatar_path from public.profiles where id='${U[0]}'")" ] && ok "quem é de fora não vê"
[ "$(as ${U[0]} "select name from public.profiles where id=auth.uid()")" = "Pessoa 1" ] && ok "o nome continua igual"
[ "$(as ${U[0]} "update public.profiles set avatar_path=null where id=auth.uid() returning 1")" = 1 ] && ok "remove a foto"
$P -f supabase/7b-desfazer-foto-de-perfil.sql >/dev/null && [ "$(as ${U[0]} "select name from public.profiles where id=auth.uid()")" = "Pessoa 1" ] && ok "desfazer tira o campo e o resto continua"
$P -f supabase/7-foto-de-perfil.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"

echo "9) Atualização leve: impressão digital dos dados (8-atualizacao-leve.sql)"
$P -f supabase/8-atualizacao-leve.sql >/dev/null && $P -f supabase/8-atualizacao-leve.sql >/dev/null && ok "script roda (2x)"
V(){ as "$1" "select public.feed_version(array['$C']::uuid[], array['$G']::uuid[])"; }
V1=$(V ${U[0]}); [ ${#V1} = 32 ] && ok "devolve só 32 letras"
[ "$(V ${U[0]})" = "$V1" ] && ok "sem mudança, a mesma impressão"
[ "$(V ${U[1]})" = "$V1" ] && ok "todos da caravana veem a mesma"
[ "$(V $FORA)" != "$V1" ] && ok "quem é de fora não enxerga os dados (impressão diferente)"
K=$(as ${U[1]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5) returning id")
V2=$(V ${U[0]}); [ "$V2" != "$V1" ] && ok "muda com publicação nova"
as ${U[2]} "insert into public.likes(checkin_id) values('$K')" >/dev/null; V3=$(V ${U[0]}); [ "$V3" != "$V2" ] && ok "muda com Amém"
as ${U[3]} "insert into public.comments(checkin_id,body) values('$K','Glória!')" >/dev/null; V4=$(V ${U[0]}); [ "$V4" != "$V3" ] && ok "muda com comentário"
as ${U[1]} "update public.checkins set note='editei' where id='$K'" >/dev/null; V5=$(V ${U[0]}); [ "$V5" != "$V4" ] && ok "muda com publicação editada"
as ${U[4]} "update public.profiles set name='Pessoa Cinco' where id=auth.uid()" >/dev/null; V6=$(V ${U[0]}); [ "$V6" != "$V5" ] && ok "muda com nome ou foto de perfil"
as ${U[2]} "delete from public.likes where checkin_id='$K'" >/dev/null; [ "$(V ${U[0]})" != "$V6" ] && ok "muda quando tira o Amém"
if $P -At -c "set role anon; select public.feed_version(array['$C']::uuid[], array['$G']::uuid[])" >/dev/null 2>&1; then echo "  ✘ anônimo usou a função"; exit 1; else ok "quem não entrou no app não consegue usar"; fi
$P -f supabase/8b-desfazer-atualizacao-leve.sql >/dev/null && fails ${U[0]} "select public.feed_version(array['$C']::uuid[], array['$G']::uuid[])" "desfazer tira a função"
$P -f supabase/8-atualizacao-leve.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "10) A líder apaga passo de qualquer pessoa da caravana (9-lider-apaga-passo.sql)"
$P -f supabase/9-lider-apaga-passo.sql >/dev/null && $P -f supabase/9-lider-apaga-passo.sql >/dev/null && ok "script roda (2x)"
K1=$(as ${U[1]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5) returning id")
as ${U[2]} "insert into public.likes(checkin_id) values('$K1')" >/dev/null; as ${U[3]} "insert into public.comments(checkin_id,body) values('$K1','Amém!')" >/dev/null
[ -z "$(as ${U[2]} "delete from public.checkins where id='$K1' returning 1")" ] && ok "participante não apaga o passo de outra pessoa"
[ -z "$(as $FORA "delete from public.checkins where id='$K1' returning 1")" ] && ok "líder de outra caravana não apaga"
[ "$(as $L "delete from public.checkins where id='$K1' returning 1")" = 1 ] && ok "a líder apaga o passo de alguém da caravana dela"
[ "$($P -At -c "select (select count(*) from public.likes where checkin_id='$K1')+(select count(*) from public.comments where checkin_id='$K1')")" = 0 ] && ok "os Amém e comentários do passo vão junto"
K2=$(as ${U[1]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5) returning id")
[ "$(as ${U[1]} "delete from public.checkins where id='$K2' returning 1")" = 1 ] && ok "cada pessoa continua apagando o próprio passo"
K3=$(as ${U[1]} "insert into public.checkins(challenge_id,read_date,chapters,study_minutes) values('$C',current_date,1,5) returning id")
$P -f supabase/9b-desfazer-lider-apaga-passo.sql >/dev/null && [ -z "$(as $L "delete from public.checkins where id='$K3' returning 1")" ] && ok "desfazer: a líder volta a não apagar"
$P -f supabase/9-lider-apaga-passo.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "11) Mural de oração (12-mural-de-oracao.sql)"
as ${U[0]} "insert into public.messages(challenge_id,body) values('$C','🙏 Pedido de oração: pela minha mãe')" >/dev/null
as ${U[0]} "insert into public.messages(challenge_id,body) values('$C','bom dia!')" >/dev/null
$P -f supabase/12-mural-de-oracao.sql >/dev/null && $P -f supabase/12-mural-de-oracao.sql >/dev/null && ok "script roda (2x)"
[ "$($P -At -c "select count(*)||':'||max(body) from public.prayer_requests")" = "1:pela minha mãe" ] && ok "pedido antigo do chat copiado uma vez só, sem o prefixo"
R=$(as ${U[1]} "insert into public.prayer_requests(group_id,title,body) values('$G','Vestibular','Pela minha prova') returning id")
RP=$(as ${U[1]} "insert into public.prayer_requests(group_id,body,is_private) values('$G','Só meu',true) returning id")
[ "$(as ${U[2]} "select count(*) from public.prayer_requests where id='$R'")" = 1 ] && ok "a caravana vê o pedido"
[ "$(as ${U[2]} "select count(*) from public.prayer_requests where id='$RP'")" = 0 ] && ok "pedido pessoal: ninguém mais vê (nem a líder)"
[ "$(as $L "select count(*) from public.prayer_requests where id='$RP'")" = 0 ] && ok "a líder também não vê o pessoal"
[ "$(as $FORA "select count(*) from public.prayer_requests")" = 0 ] && ok "quem é de fora não vê nada"
fails $FORA "insert into public.prayer_requests(group_id,body) values('$G','invasor')" "de fora não escreve na caravana"
fails ${U[2]} "insert into public.prayer_requests(user_id,group_id,body) values('${U[1]}','$G','em nome de outro')" "não escreve em nome de outra pessoa"
as ${U[2]} "insert into public.prayer_intercessions(request_id) values('$R')" >/dev/null; as ${U[0]} "insert into public.prayer_intercessions(request_id) values('$R')" >/dev/null
[ "$(as $L "select count(*) from public.prayer_intercessions where request_id='$R'")" = 2 ] && ok "2 orando, e todos veem o número"
fails ${U[2]} "insert into public.prayer_intercessions(request_id) values('$R')" "cada pessoa conta uma vez só"
fails ${U[1]} "insert into public.prayer_intercessions(request_id) values('$R')" "o autor não conta como orando no próprio pedido"
fails $FORA "insert into public.prayer_intercessions(request_id) values('$R')" "de fora não ora (não vê o pedido)"
fails ${U[2]} "insert into public.prayer_intercessions(request_id) values('$RP')" "ninguém ora no pessoal de outro"
[ -z "$(as ${U[0]} "delete from public.prayer_intercessions where request_id='$R' and user_id='${U[2]}' returning 1")" ] && ok "não tira o Orar de outra pessoa"
[ "$(as ${U[0]} "delete from public.prayer_intercessions where request_id='$R' returning 1")" = 1 ] && ok "tocar de novo desfaz o próprio Orar"
[ -z "$(as ${U[2]} "update public.prayer_requests set body='mudei' where id='$R' returning 1")" ] && ok "outra pessoa não edita o pedido"
[ "$(as ${U[1]} "update public.prayer_requests set answered_at=now(),testimony='Passei!' where id='$R' returning 1")" = 1 ] && ok "o autor marca como respondido com testemunho"
fails ${U[0]} "insert into public.prayer_intercessions(request_id) values('$R')" "pedido respondido não recebe novo Orar"
fails ${U[1]} "update public.prayer_requests set group_id='$G2',is_private=false where id='$RP'" "não muda o pedido para caravana alheia"
[ -z "$(as ${U[2]} "delete from public.prayer_requests where id='$R' returning 1")" ] && ok "participante não apaga pedido de outro"
[ -z "$(as $FORA "delete from public.prayer_requests where id='$R' returning 1")" ] && ok "líder de outra caravana não apaga"
[ -z "$(as $L "delete from public.prayer_requests where id='$RP' returning 1")" ] && ok "a líder não apaga o pessoal de ninguém"
[ "$(as $L "delete from public.prayer_requests where id='$R' returning 1")" = 1 ] && ok "a líder apaga pedido da caravana dela"
[ "$($P -At -c "select count(*) from public.prayer_intercessions where request_id='$R'")" = 0 ] && ok "quem orava vai junto"
[ "$(as ${U[1]} "delete from public.prayer_requests where id='$RP' returning 1")" = 1 ] && ok "o autor apaga o próprio"
$P -f supabase/12b-desfazer-mural-de-oracao.sql >/dev/null && [ "$($P -At -c "select to_regclass('public.prayer_requests') is null")" = t ] && ok "desfazer tira as tabelas"
$P -f supabase/12-mural-de-oracao.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "12) Orando agora (13-orando-agora.sql)"
R2=$(as ${U[1]} "insert into public.prayer_requests(group_id,body) values('$G','Pela viagem') returning id")
as ${U[0]} "insert into public.prayer_intercessions(request_id) values('$R2')" >/dev/null
$P -c "update public.prayer_intercessions set created_at=now()-interval '1 day'" >/dev/null
$P -f supabase/13-orando-agora.sql >/dev/null && $P -f supabase/13-orando-agora.sql >/dev/null && ok "script roda (2x)"
[ "$($P -At -c "select bool_and(prayed_at < now()-interval '1 hour') from public.prayer_intercessions")" = t ] && ok "quem já orava antes não aparece como 'agora'"
as ${U[2]} "insert into public.prayer_intercessions(request_id) values('$R2')" >/dev/null
[ "$($P -At -c "select prayed_at > now()-interval '1 minute' from public.prayer_intercessions where request_id='$R2' and user_id='${U[2]}'")" = t ] && ok "Orar marca o horário de agora"
[ "$(as ${U[0]} "update public.prayer_intercessions set prayed_at='2999-01-01' where request_id='$R2' returning prayed_at > now()-interval '1 minute' and prayed_at <= now()")" = t ] && ok "'orando de novo' usa a hora do servidor (não dá para ficar 'agora' para sempre)"
[ -z "$(as ${U[0]} "update public.prayer_intercessions set prayed_at=now() where user_id='${U[2]}' returning 1")" ] && ok "não atualiza o horário de outra pessoa"
fails ${U[0]} "update public.prayer_intercessions set request_id='$R' where request_id='$R2'" "não troca o pedido da oração"
fails ${U[0]} "update public.prayer_intercessions set user_id='${U[2]}' where request_id='$R2'" "não troca a pessoa"
$P -f supabase/13b-desfazer-orando-agora.sql >/dev/null && [ "$($P -At -c "select count(*) from information_schema.columns where table_name='prayer_intercessions' and column_name='prayed_at'")" = 0 ] && ok "desfazer tira a coluna"
$P -f supabase/13-orando-agora.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "13) Terminar a oração (14-terminar-oracao.sql)"
$P -f supabase/14-terminar-oracao.sql >/dev/null && $P -f supabase/14-terminar-oracao.sql >/dev/null && ok "script roda (2x)"
[ "$($P -At -c "select praying from public.prayer_intercessions where request_id='$R2' and user_id='${U[2]}'")" = t ] && ok "quem orou há pouco continua 'orando agora'"
$P -c "set session_replication_role=replica; update public.prayer_intercessions set prayed_at=now()-interval '1 hour' where request_id='$R2' and user_id='${U[0]}'" >/dev/null # sem o gatilho, para simular quem orou há 1 hora
[ "$(as ${U[0]} "update public.prayer_intercessions set praying=false where request_id='$R2' returning praying::text||':'||(prayed_at < now()-interval '30 minutes')::text")" = "false:true" ] && ok "terminar guarda a hora em que orou"
[ "$($P -At -c "select count(*) from public.prayer_intercessions where request_id='$R2' and user_id='${U[0]}'")" = 1 ] && ok "terminar não tira do contador"
[ "$(as ${U[0]} "update public.prayer_intercessions set praying=true where request_id='$R2' returning praying::text||':'||(prayed_at > now()-interval '1 minute')::text")" = "true:true" ] && ok "orar de novo volta a 'orando agora' com a hora do servidor"
R3=$(as ${U[1]} "insert into public.prayer_requests(group_id,body) values('$G','Pelo emprego') returning id")
[ "$(as ${U[0]} "insert into public.prayer_intercessions(request_id,praying) values('$R3',false) returning praying")" = t ] && ok "Orar sempre começa 'orando agora'"
[ -z "$(as ${U[0]} "update public.prayer_intercessions set praying=false where user_id='${U[2]}' returning 1")" ] && ok "não termina a oração de outra pessoa"
$P -f supabase/14b-desfazer-terminar-oracao.sql >/dev/null && [ "$($P -At -c "select count(*) from information_schema.columns where table_name='prayer_intercessions' and column_name='praying'")" = 0 ] && ok "desfazer tira a coluna"
$P -f supabase/14-terminar-oracao.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "14) Meu momento de oração (15-meu-momento-de-oracao.sql)"
$P -f supabase/15-meu-momento-de-oracao.sql >/dev/null && $P -f supabase/15-meu-momento-de-oracao.sql >/dev/null && ok "script roda (2x)"
S1=11111111-1111-4111-8111-111111111111; S2=22222222-2222-4222-8222-222222222222; S3=33333333-3333-4333-8333-333333333333
[ "$(as ${U[0]} "insert into public.prayer_sessions(id,started_at) values('$S1',now()-interval '20 minutes') returning status")" = active ] && ok "começar a orar grava a oração em andamento"
[ "$(as ${U[0]} "insert into public.prayer_sessions(id,started_at) values('$S1',now()) on conflict (id) do nothing returning 1")" = "" ] && ok "repetir o mesmo envio não duplica"
fails ${U[0]} "insert into public.prayer_sessions(id,started_at) values('$S2',now())" "no máximo uma oração em andamento por pessoa"
[ "$(as ${U[0]} "select count(*) from public.prayer_sessions")" = 1 ] && ok "a pessoa vê a própria oração"
[ "$(as ${U[1]} "select count(*) from public.prayer_sessions")" = 0 ] && ok "outra pessoa da caravana não vê nada"
[ "$(as $L "select count(*) from public.prayer_sessions")" = 0 ] && ok "nem a líder vê"
[ "$($P -At -c "set role anon; select count(*) from public.prayer_sessions" 2>/dev/null)" = "" ] && ok "quem não entrou no app não lê a tabela"
[ -z "$(as ${U[1]} "update public.prayer_sessions set status='done',ended_at=now() where id='$S1' returning 1")" ] && ok "outra pessoa não encerra a oração alheia"
[ -z "$(as ${U[1]} "delete from public.prayer_sessions where id='$S1' returning 1")" ] && ok "outra pessoa não apaga a oração alheia"
fails ${U[1]} "insert into public.prayer_sessions(user_id,started_at) values('${U[0]}',now())" "não cria oração em nome de outra pessoa"
fails ${U[0]} "update public.prayer_sessions set status='done',ended_at=now()-interval '1 hour' where id='$S1'" "término antes do início é recusado"
fails ${U[0]} "update public.prayer_sessions set started_at=now()-interval '5 hours' where id='$S1'" "o início não pode ser mexido depois"
[ "$(as ${U[0]} "update public.prayer_sessions set status='done',ended_at=now()+interval '3 hours' where id='$S1' returning duration_s between 1199 and 1202")" = t ] && ok "término no futuro vira a hora do servidor; duração em segundos"
[ "$(as ${U[0]} "update public.prayer_sessions set status='done',ended_at=now()-interval '19 minutes' where id='$S1' returning duration_s between 1199 and 1202")" = t ] && ok "encerrar de novo (outro aparelho) mantém o primeiro registro"
[ "$(as ${U[0]} "update public.prayer_sessions set status='active',ended_at=null where id='$S1' returning status")" = done ] && ok "oração concluída não volta a ficar em andamento"
[ "$($P -At -c "select extract(microseconds from started_at)::int % 1000000 = 0 from public.prayer_sessions where id='$S1'")" = t ] && ok "horários guardados em segundos inteiros"
[ "$(as ${U[0]} "insert into public.prayer_sessions(id,started_at,status,ended_at) values('$S2',now()+interval '1 hour','active',null) returning started_at <= now()")" = t ] && ok "início no futuro (relógio adiantado) vira a hora do servidor"
as ${U[0]} "delete from public.prayer_sessions where id='$S2'" >/dev/null
fails ${U[0]} "insert into public.prayer_sessions(id,started_at,status,ended_at) values('$S3',now()-interval '30 hours','done',now())" "oração de mais de 24 horas é recusada"
fails ${U[0]} "insert into public.prayer_sessions(started_at) values(now()-interval '40 days')" "início muito antigo é recusado"
[ "$(as ${U[0]} "insert into public.prayer_sessions(id,started_at,status,ended_at) values('$S3',now()-interval '2 hours','done',now()-interval '1 hour') returning duration_s")" = 3600 ] && ok "oração encerrada sem internet chega já concluída"
fails ${U[0]} "insert into public.prayer_shares(session_id,group_id) values('$S1','$G2')" "não compartilha em caravana alheia"
fails ${U[1]} "insert into public.prayer_shares(session_id,group_id) values('$S1','$G')" "não compartilha a oração de outra pessoa"
as ${U[0]} "insert into public.prayer_sessions(id,started_at) values('$S2',now()-interval '5 minutes')" >/dev/null
fails ${U[0]} "insert into public.prayer_shares(session_id,group_id) values('$S2','$G')" "oração em andamento não é compartilhada"
[ "$(as ${U[0]} "insert into public.prayer_shares(session_id,group_id,started_at) values('$S1','$G','2000-01-01') returning started_at = (select started_at from public.prayer_sessions where id='$S1')")" = t ] && ok "compartilhar usa o horário de início da própria oração"
fails ${U[0]} "insert into public.prayer_shares(session_id,group_id) values('$S1','$G')" "compartilhar duas vezes não duplica"
[ "$(as ${U[2]} "select count(*) from public.prayer_shares where group_id='$G'")" = 1 ] && ok "a caravana vê o compartilhamento"
[ "$(as $FORA "select count(*) from public.prayer_shares")" = 0 ] && ok "quem é de fora não vê"
[ "$($P -At -c "select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='prayer_shares'")" = "session_id,user_id,group_id,started_at,created_at" ] && ok "compartilhamento sem duração, sem término, sem totais"
[ "$(as ${U[2]} "select count(*) from public.prayer_sessions where id='$S1'")" = 0 ] && ok "quem vê o compartilhamento continua sem ver a oração"
[ -z "$(as ${U[2]} "delete from public.prayer_shares where session_id='$S1' returning 1")" ] && ok "outra pessoa não remove o compartilhamento"
[ "$(as ${U[0]} "delete from public.prayer_shares where session_id='$S1' returning 1")" = 1 ] && ok "a própria pessoa remove o compartilhamento"
as ${U[0]} "insert into public.prayer_shares(session_id,group_id) values('$S3','$G')" >/dev/null
[ "$(as ${U[0]} "delete from public.prayer_sessions where id='$S3' returning 1")" = 1 ] && [ "$($P -At -c "select count(*) from public.prayer_shares where session_id='$S3'")" = 0 ] && ok "apagar a oração apaga o compartilhamento"
N1=$($P -At -c "select count(*) from public.prayer_requests")
$P -f supabase/15b-desfazer-meu-momento-de-oracao.sql >/dev/null && [ "$($P -At -c "select to_regclass('public.prayer_sessions') is null and to_regclass('public.prayer_shares') is null")" = t ] && ok "desfazer tira as tabelas"
[ "$($P -At -c "select count(*) from public.prayer_requests")" = "$N1" ] && ok "desfazer não mexe no mural"
$P -f supabase/15-meu-momento-de-oracao.sql >/dev/null && ok "pode aplicar de novo depois de desfazer"
echo "TODOS OS TESTES DO BANCO PASSARAM"
