# Testes

## Testes do app (vários usuários ao mesmo tempo)
`node testes/teste-app.js` — abre um navegador por pessoa contra um Supabase falso
(`testes/supabase-falso.js`) que segue as mesmas regras de acesso do banco, devolve no máximo
1000 linhas por consulta (como o Supabase) e permite simular internet caindo ou lenta.

Para ver os problemas na versão antiga:
```
git show 195005b:index.html > /tmp/antes.html
node testes/teste-app.js /tmp/antes.html
```

## Testes do banco
`PGHOST=... PGPORT=... PGUSER=postgres bash testes/teste-banco.sh` — cria num PostgreSQL local uma
cópia da estrutura do banco (`testes/banco-simulado.sql`), com 6 usuários, e testa os scripts de
`supabase/` antes e depois: lista de integrantes, saída da caravana, publicações simultâneas,
duplicadas, segurança e o "desfazer". **Nunca rode `banco-simulado.sql` no Supabase.**
