// Testes do app com vários usuários ao mesmo tempo (um navegador por pessoa) e um Supabase falso.
// Uso: node testes/teste-app.js [arquivo.html]   (padrão: index.html)
// Cada teste diz o que verifica; no fim sai uma tabela de resultados.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const { novoServidor, cliente } = require('./supabase-falso');

const RAIZ = path.join(__dirname, '..');
const HTML = path.resolve(process.argv[2] || path.join(RAIZ, 'index.html'));
const resultados = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// servidor de arquivos do app (index.html em teste + pasta biblia)
function servirApp() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (u === '/' || u === '/index.html') { rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return rsp.end(fs.readFileSync(HTML)) }
      const f = path.join(RAIZ, u);
      if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end() }
      rsp.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); rsp.end(fs.readFileSync(f));
    }).listen(0, () => res(srv));
  });
}

async function abrir(browser, base, S, u, extra = {}) {
  const opc = Object.assign({ viewport: { width: 390, height: 844 } }, extra); delete opc.relogio;
  const ctx = await browser.newContext(opc);
  await ctx.grantPermissions(['microphone']).catch(() => {});
  await ctx.exposeFunction('__api', async (me, q) => JSON.stringify(await S.handle(me, JSON.parse(q))));
  await ctx.route('**/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: cliente }));
  await ctx.route('**/auth/v1/settings', r => r.fulfill({ contentType: 'application/json', body: '{"external":{"phone":false}}' }));
  await ctx.route('https://bible-api.com/**', r => r.abort());
  await ctx.addInitScript(([id, md]) => { if (!localStorage.getItem('fake_me')) { localStorage.setItem('fake_me', id); localStorage.setItem('fake_md', md) } }, [u.id, JSON.stringify(u.md || {})]);
  const pg = await ctx.newPage();
  if (extra.relogio) await pg.clock.install({ time: new Date(extra.relogio) });
  pg.erros = []; pg.on('pageerror', e => pg.erros.push(e.message));
  await pg.goto(base + '/');
  await pg.waitForFunction(() => window.loaded === true || (typeof loaded !== 'undefined' && loaded), null, { timeout: 15000 });
  // tempo-limite curto nos testes (no app real são 45 s)
  await pg.evaluate(() => { if (window.withTimeout) { const o = window.withTimeout; window.withTimeout = (p, ms) => o(p, Math.min(ms, 1200)) } });
  return pg;
}
const recarregar = pg => pg.evaluate(() => loadData());
const contaPosts = pg => pg.evaluate(() => S.posts.filter(p => p.cid === S.cur).length);

// Abre o "Passo", põe uma foto, escolhe 15 min e publica
async function darPasso(pg, opts = {}) {
  await pg.evaluate(() => { closeSheet(); tab = 'feed'; render() });
  await pg.click('#add');
  await pg.waitForSelector('#fgal', { state: 'attached' });
  await pg.setInputFiles('#fgal', { name: (opts.foto || 'foto') + '.png', mimeType: 'image/png', buffer: opts.buffer || PNG });
  await pg.waitForSelector('.mth');
  await pg.click('[data-mn="15"]');
  await pg.click('#ok');
}
async function esperar(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)) } return false }

async function teste(nome, fn) {
  if (process.env.SO && !nome.includes(process.env.SO)) return; // SO="trecho do nome" roda só os testes que combinam
  const t0 = Date.now();
  try { const det = await fn(); resultados.push({ nome, ok: true, det: det || '', ms: Date.now() - t0 }); console.log('  ✔ ' + nome + (det ? ' — ' + det : '')) }
  catch (e) { resultados.push({ nome, ok: false, det: e.message.split('\n')[0], ms: Date.now() - t0 }); console.log('  ✘ ' + nome + ' — ' + e.message.split('\n')[0]) }
}
function exige(c, msg) { if (!c) throw new Error(msg) }

(async () => {
  const srv = await servirApp(), base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); // microfone simulado
  console.log('Testando ' + path.relative(RAIZ, HTML));

  // ---------- 1. Participantes da caravana ----------
  await teste('Caravana com 6 pessoas: todos aparecem para todos (nome e contagem)', async () => {
    const S = novoServidor();
    const L = S.usuario('Líder Ana'), P = [1, 2, 3, 4, 5].map(i => S.usuario('Pessoa ' + i));
    const g = S.caravana(L, 'Caravana Teste'); P.forEach(u => S.entrar(u, g)); S.entrar(P[0], g);
    const c = S.jornada(g, 'Romanos em 16 dias'); S.publicacao(L, c);
    exige(S.DB.gm.filter(m => m.group_id === g.id).length === 6, 'vínculos duplicados ou faltando');
    const pgs = await Promise.all([L, ...P].map(u => abrir(browser, base, S, u)));
    for (const pg of pgs) {
      const cs = await pg.textContent('#cs');
      exige(/6 peregrinos/.test(cs), 'cabeçalho mostra "' + cs + '" em vez de 6 peregrinos');
      await pg.click('nav [data-t="cfg"]');
      const t = await pg.textContent('main');
      exige(/Integrantes \(6\)/.test(t), 'lista de integrantes não mostra 6');
      for (const n of ['Líder Ana', 'Pessoa 1', 'Pessoa 5']) exige(t.includes(n), 'falta ' + n + ' na lista');
      const rk = await pg.$$eval('.rk .grow b', e => e.length); exige(rk >= 6, 'ranking com ' + rk + ' pessoas');
    }
    await Promise.all(pgs.map(p => p.context().close()));
    return '6 navegadores, cada um vê os 6 integrantes com nome';
  });

  await teste('Novo participante aparece para os outros sem fechar o app; saída atualiza a contagem', async () => {
    const S = novoServidor();
    const L = S.usuario('Líder'), A = S.usuario('Ana'), B = S.usuario('Bruno');
    const g = S.caravana(L, 'Grupo'); S.entrar(A, g); S.jornada(g, 'João em 21 dias');
    const pl = await abrir(browser, base, S, L);
    exige(/2 peregrinos/.test(await pl.textContent('#cs')), 'começo errado: ' + await pl.textContent('#cs'));
    S.entrar(B, g); await recarregar(pl);
    exige(/3 peregrinos/.test(await pl.textContent('#cs')), 'novo participante não apareceu');
    const pb = await abrir(browser, base, S, B);
    await pb.click('nav [data-t="cfg"]'); pb.once('dialog', d => d.accept());
    await pb.click('[data-leave]'); await esperar(() => S.DB.gm.length === 2);
    await recarregar(pl);
    exige(/2 peregrinos/.test(await pl.textContent('#cs')), 'contagem não voltou para 2 após a saída');
    exige(!S.DB.gm.some(m => m.user_id === B.id), 'vínculo não foi removido');
    await pl.context().close(); await pb.context().close();
    return 'entrou → 3; saiu → 2';
  });

  await teste('Caravana não aparece repetida e o papel é o da própria pessoa (líder edita, participante não)', async () => {
    const S = novoServidor();
    const L = S.usuario('Líder'), A = S.usuario('Ana'), B = S.usuario('Bruno');
    const g = S.caravana(L, 'Família'); S.entrar(A, g); S.entrar(B, g); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A), pl = await abrir(browser, base, S, L);
    const va = await pa.evaluate(() => ({ n: S.groups.length, edita: S.canEdit, papel: S.grp.role }));
    const vl = await pl.evaluate(() => ({ n: S.groups.length, edita: S.canEdit, papel: S.grp.role }));
    await pa.context().close(); await pl.context().close();
    exige(va.n === 1 && vl.n === 1, 'caravana repetida: participante vê ' + va.n + ', líder vê ' + vl.n);
    exige(!va.edita && va.papel === 'member', 'participante com papel ' + va.papel);
    exige(vl.edita && vl.papel === 'leader', 'líder com papel ' + vl.papel);
  });

  await teste('Data fora do período da jornada: o servidor recusa e o app explica', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); const c = S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    c.end_date = c.start_date = '2020-01-01'; // o líder mudou as datas depois que a tela abriu
    await darPasso(pa);
    await esperar(async () => /Não foi possível/.test(await pa.textContent('#er')));
    const msg = await pa.textContent('#er'); await pa.context().close();
    exige(/período da jornada/.test(msg), 'mensagem: ' + msg);
    exige(Object.keys(S.DB.checkins).length === 0, 'gravou');
    return msg.slice(0, 90);
  });

  await teste('Quem é de fora não vê integrantes nem publicações da caravana', async () => {
    const S = novoServidor();
    const L = S.usuario('Líder'), F = S.usuario('De Fora');
    const g = S.caravana(L, 'Fechada'), c = S.jornada(g, 'Salmos em 30 dias'); S.publicacao(L, c);
    const gf = S.caravana(F, 'Outra'); S.jornada(gf, 'Gênesis em 50 dias');
    const pf = await abrir(browser, base, S, F);
    const vis = await pf.evaluate(() => ({ posts: S.posts.length, grupos: S.groups.map(g => g.name), roster: Object.keys(S.roster || {}) }));
    exige(vis.posts === 0 && vis.grupos.join() === 'Outra', 'vazou: ' + JSON.stringify(vis));
    await pf.context().close();
  });

  // ---------- 2. Publicações ----------
  await teste('Publicação aparece no mural na hora e para os outros integrantes', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A), pb = await abrir(browser, base, S, B);
    await darPasso(pa);
    exige(await esperar(async () => (await contaPosts(pa)) === 1), 'não apareceu para quem publicou');
    exige(Object.keys(S.DB.checkins).length === 1, 'gravou ' + Object.keys(S.DB.checkins).length);
    await recarregar(pb); exige((await contaPosts(pb)) === 1, 'não apareceu para o outro integrante');
    await pa.context().close(); await pb.context().close();
  });

  await teste('Internet caiu DEPOIS de gravar: app confirma sozinho, sem duplicar', async () => {
    const S = novoServidor(); S.O.falhas['checkins:insert:depois'] = 1;
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await darPasso(pa);
    const ok = await esperar(async () => (await contaPosts(pa)) === 1 && !(await pa.$('#sh.show')), 8000);
    const n = Object.keys(S.DB.checkins).length;
    if (!ok) { const er = await pa.textContent('#er').catch(() => ''); await pa.click('#ok').catch(() => {}); await new Promise(r => setTimeout(r, 2500)) }
    const n2 = Object.keys(S.DB.checkins).length;
    await pa.context().close();
    exige(ok, 'o app não reconheceu que a publicação foi salva (gravadas depois de tentar de novo: ' + n2 + ')');
    exige(n2 === 1, 'publicação duplicada: ' + n2);
    return 'reconheceu a gravação e mostrou "Passo publicado"';
  });

  await teste('Internet caiu ANTES de gravar: mensagem clara e "Tentar de novo" grava uma vez só', async () => {
    const S = novoServidor(); S.O.falhas['checkins:insert'] = ['antes'];
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await darPasso(pa);
    await esperar(async () => /Não foi possível/.test(await pa.textContent('#er')));
    const msg = await pa.textContent('#er'); exige(/Não foi possível/.test(msg), 'sem mensagem de erro');
    exige(Object.keys(S.DB.checkins).length === 0, 'gravou mesmo com erro');
    await pa.click('#ok'); await esperar(async () => (await contaPosts(pa)) === 1);
    exige(Object.keys(S.DB.checkins).length === 1, 'gravadas: ' + Object.keys(S.DB.checkins).length);
    await pa.context().close();
    return 'mensagem: "' + msg.slice(0, 60) + '…"';
  });

  await teste('App fechado no meio do envio (fotos subiram, publicação não): é enviada sozinha ao abrir de novo', async () => {
    const S = novoServidor(); S.O.falhas['checkins:insert'] = ['travar'];
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await darPasso(pa);
    await esperar(() => Object.keys(S.DB.objects).length > 0);
    await new Promise(r => setTimeout(r, 300));
    exige(Object.keys(S.DB.checkins).length === 0, 'já gravou antes de fechar');
    await pa.reload(); // a pessoa fechou e abriu o app
    await pa.waitForFunction(() => typeof loaded !== 'undefined' && loaded);
    const ok = await esperar(() => Object.keys(S.DB.checkins).length === 1, 6000);
    await pa.reload(); await pa.waitForFunction(() => typeof loaded !== 'undefined' && loaded); await new Promise(r => setTimeout(r, 800));
    const n = Object.keys(S.DB.checkins).length, vis = await contaPosts(pa);
    await pa.context().close();
    exige(ok, 'a publicação pendente não foi enviada');
    exige(n === 1 && vis === 1, 'gravadas ' + n + ', na tela ' + vis);
    return 'publicada ao reabrir; reabrir de novo não duplicou';
  });

  await teste('Excluir jornada com publicações exige escrever EXCLUIR', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); const c = S.jornada(g, 'Romanos em 16 dias'); S.publicacao(A, c);
    let apagou = false; const h = S.handle; S.handle = async (me, q) => { if (q.table === 'challenges' && q.op === 'delete') apagou = true; return h(me, q) };
    const pa = await abrir(browser, base, S, A);
    await pa.click('nav [data-t="cfg"]');
    let txt = ''; pa.once('dialog', d => { txt = d.message(); d.accept('sim') });
    await pa.click('[data-d]'); await new Promise(r => setTimeout(r, 400));
    exige(!apagou, 'apagou sem escrever EXCLUIR');
    exige(/1 publicação de 1 pessoa/.test(txt), 'aviso: ' + txt.slice(0, 80));
    pa.once('dialog', d => d.accept('excluir')); await pa.click('[data-d]'); await new Promise(r => setTimeout(r, 400));
    await pa.context().close();
    exige(apagou, 'não apagou mesmo com EXCLUIR');
  });

  await teste('Atualização automática lenta não apaga da tela a publicação recém-feita', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    S.O.atrasos['checkins:select'] = [2500]; // a próxima busca de publicações demora (internet lenta)
    pa.evaluate(() => loadData()); // atualização automática começa ANTES da publicação
    await new Promise(r => setTimeout(r, 200));
    await darPasso(pa);
    await new Promise(r => setTimeout(r, 4000)); // a busca lenta termina depois
    const n = await contaPosts(pa);
    await pa.context().close();
    exige(n === 1, 'a publicação sumiu da tela (mostrando ' + n + ')');
  });

  await teste('Mais de 1000 publicações: nenhuma some (o Supabase devolve 1000 por vez)', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g);
    const c = S.jornada(g, 'Bíblia em 1 ano', -400, 0);
    for (let i = 0; i < 1300; i++) S.publicacao(i % 2 ? A : B, c, { created_at: new Date(Date.now() - (i + 5) * 6e4).toISOString(), ref: String(i % 50 + 1) });
    const pa = await abrir(browser, base, S, A);
    const n = await contaPosts(pa);
    await pa.context().close();
    exige(n === 1300, 'carregou ' + n + ' de 1300');
    return 'carregou as 1300';
  });

  await teste('5 pessoas publicando ao mesmo tempo: as 5 gravadas e visíveis para todos', async () => {
    const S = novoServidor();
    const U = [1, 2, 3, 4, 5].map(i => S.usuario('Pessoa ' + i)); const g = S.caravana(U[0], 'G'); U.slice(1).forEach(u => S.entrar(u, g)); S.jornada(g, 'Romanos em 16 dias');
    const pgs = await Promise.all(U.map(u => abrir(browser, base, S, u)));
    await Promise.all(pgs.map((p, i) => darPasso(p, { foto: 'f' + i, buffer: Buffer.concat([PNG, Buffer.from([i])]) })));
    await esperar(() => Object.keys(S.DB.checkins).length === 5);
    for (const p of pgs) { await recarregar(p); exige((await contaPosts(p)) === 5, 'alguém vê ' + (await contaPosts(p))) }
    exige(Object.keys(S.DB.checkins).length === 5, 'gravadas ' + Object.keys(S.DB.checkins).length);
    await Promise.all(pgs.map(p => p.context().close()));
  });

  await teste('Banco ainda sem a coluna client_key: publicação continua funcionando', async () => {
    const S = novoServidor({ semClientKey: true });
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A); await darPasso(pa);
    exige(await esperar(async () => (await contaPosts(pa)) === 1), 'não publicou');
    await pa.context().close();
  });

  await teste('Lista de integrantes não depende de função extra no banco', async () => {
    const S = novoServidor({ rosterRpc: false });
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g); const c = S.jornada(g, 'João em 21 dias'); S.publicacao(B, c);
    const pa = await abrir(browser, base, S, A); await pa.click('nav [data-t="cfg"]');
    const t = await pa.textContent('main'); await pa.context().close();
    exige(/Integrantes \(2\)/.test(t), 'lista: ' + t.slice(0, 80)); exige(pa.erros.length === 0, pa.erros.join());
  });

  // ---------- 3. Registro de leitura ----------
  await teste('Registro: 5 minutos existe, tempo e capítulos somam certo, capítulo repetido é bloqueado', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add'); exige(await pa.$('[data-mn="5"]'), 'sem opção de 5 minutos');
    await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.click('[data-mn="5"]'); await pa.click('#ok');
    await esperar(() => Object.keys(S.DB.checkins).length === 1);
    const k = Object.values(S.DB.checkins)[0];
    exige(k.study_minutes === 5, 'gravou ' + k.study_minutes + ' min');
    const st = await pa.textContent('#stats'); exige(/5 min/.test(st), 'estatística: ' + st);
    const bloqueado = await pa.evaluate(k => { const s = readSet(S.me); return chOfPost({ book: k.book, ref: k.ref }).every(x => s[x]) }, k);
    exige(bloqueado, 'capítulo já lido não ficou travado');
    await pa.context().close();
  });

  await teste('Fuso horário: leitura às 23h30 em Brasília fica com a data de Brasília (no UTC já é o dia seguinte)', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias', -5, 12);
    const agora = new Date(), utc = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 2, 30)); // 02h30 UTC = 23h30 do dia anterior em Brasília
    const pa = await abrir(browser, base, S, A, { timezoneId: 'America/Sao_Paulo', relogio: utc.toISOString() });
    const esperado = utc.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const local = await pa.evaluate(() => TODAY);
    await darPasso(pa); await esperar(() => Object.keys(S.DB.checkins).length === 1);
    const k = Object.values(S.DB.checkins)[0];
    await pa.context().close();
    exige(local === esperado, 'TODAY=' + local + ' esperado ' + esperado);
    exige(k && k.read_date === esperado, 'gravou ' + (k && k.read_date) + ', esperado ' + esperado);
    return 'UTC ' + utc.toISOString().slice(0, 16) + ' → data gravada ' + k.read_date;
  });

  // ---------- 4. Bíblia ----------
  await teste('Bíblia: só versões lidas dentro do app, ir para o versículo e voltar onde parou', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('nav [data-t="bib"]');
    const vers = await pa.$$eval('#bver option', o => o.map(x => x.value));
    exige(vers.join() === 'ALM,TB,BLIVRE', 'versões: ' + vers);
    await pa.click('[data-bb="42"]'); await pa.click('[data-bgo="42:3"]');
    await pa.waitForSelector('#v16'); await pa.selectOption('#vsel', '16');
    const hl = await pa.$eval('#v16', e => e.classList.contains('hl')); exige(hl, 'não destacou o versículo');
    await pa.evaluate(() => { BIB.v = 'books'; render() });
    const cont = await pa.textContent('[data-bv2]'); exige(/João 3:16/.test(cont), 'continuar: ' + cont);
    const ext = await pa.$$eval('a[href*="bible.com"]', a => a.length); exige(ext === 0, 'ainda tem link externo');
    await pa.context().close();
  });

  await teste('Bíblia sem internet: livro já aberto continua lendo', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('nav [data-t="bib"]'); await pa.click('[data-bb="18"]'); await pa.click('[data-bgo="18:23"]'); await pa.waitForSelector('#v1');
    await pa.context().route('**/biblia/**', r => r.abort()); // sem internet
    await pa.evaluate(() => { localStorage.clear(); BC = {}; BB = {} });
    await pa.evaluate(() => { localStorage.setItem('fake_me', S.me) });
    await pa.evaluate(() => bibGo('read', 18, 22)); await pa.evaluate(() => bibGo('read', 18, 23));
    const ok = await esperar(async () => !!(await pa.$('#v6')), 4000);
    await pa.context().close();
    exige(ok, 'não leu sem internet');
  });

  // ---------- 5. Fotos e vídeos ----------
  await teste('Vídeo com mais de 15 segundos é recusado com explicação', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.evaluate(() => { vidDur = () => Promise.resolve(42) }); // simula um vídeo de 42 s
    await pa.click('#add'); await pa.setInputFiles('#fgal', { name: 'v.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2000) });
    await esperar(async () => /15 segundos/.test(await pa.textContent('#er')));
    const msg = await pa.textContent('#er'), n = await pa.$$eval('.mth', e => e.length);
    await pa.context().close();
    exige(/15 segundos/.test(msg) && n === 0, 'aceitou: ' + msg);
    return msg;
  });

  await teste('Mesma foto duas vezes: um arquivo só; foto grande vira ≤300 KB com miniatura', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    const r = await pa.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d'); const d = x.createImageData(4000, 3000); for (let i = 0; i < d.data.length; i++)d.data[i] = Math.random() * 255; x.putImageData(d, 0, 0);
      const f = await new Promise(r => c.toBlob(b => r(new File([b], 'g.jpg', { type: 'image/jpeg' })), 'image/jpeg', .95));
      S.media = [{ file: f, src: 'galeria', img: '' }, { file: f, src: 'galeria', img: '' }];
      const pm = await upMedia(); return { paths: pm.photo_path.split('|'), orig: f.size };
    });
    const objs = Object.entries(S.DB.objects);
    await pa.context().close();
    exige(r.paths.length === 1, 'duplicou na publicação');
    exige(objs.length === 2 && objs.some(([k]) => k.endsWith('.t.jpg')), 'arquivos: ' + objs.map(o => o[0]).join());
    const foto = objs.find(([k]) => !k.endsWith('.t.jpg'))[1].size, mini = objs.find(([k]) => k.endsWith('.t.jpg'))[1].size;
    exige(foto <= 300 * 1024, 'foto com ' + Math.round(foto / 1024) + ' KB');
    return 'original ' + Math.round(r.orig / 1024) + ' KB → foto ' + Math.round(foto / 1024) + ' KB + miniatura ' + Math.round(mini / 1024) + ' KB';
  });

  await teste('Links das fotos são reaproveitados (não baixa tudo de novo a cada 30 s)', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); const c = S.jornada(g, 'Romanos em 16 dias');
    for (let i = 0; i < 5; i++) S.publicacao(A, c, { ref: String(i + 1) });
    const pa = await abrir(browser, base, S, A);
    const a1 = await pa.$$eval('img.media', i => i.map(x => x.src).join());
    const n0 = S.log.filter(l => l.t === 1 && l.op === 'sign').length;
    await recarregar(pa); await recarregar(pa);
    const a2 = await pa.$$eval('img.media', i => i.map(x => x.src).join());
    const n1 = S.log.filter(l => l.t === 1 && l.op === 'sign').length;
    await pa.context().close();
    exige(a1 === a2, 'endereços das fotos mudaram');
    exige(n1 === n0, 'pediu ' + (n1 - n0) + ' novos links');
  });

  await teste('Reflexão e comentários mantêm parágrafos, linhas em branco e quebras (antigos e novos)', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g); const c = S.jornada(g, 'Romanos em 16 dias');
    const antigo = 'Primeiro parágrafo.\nSegunda linha.\n\n  Novo parágrafo com recuo.';
    const k = S.publicacao(B, c, { note: antigo, photo_path: B.id + '/x.jpg' }); S.DB.objects[B.id + '/x.jpg'] = { size: 1 };
    S.DB.comments['c1'] = { id: 'c1', checkin_id: k.id, user_id: A.id, body: 'Amém!\nQue palavra.\n\nObrigado.', created_at: new Date().toISOString() };
    const pa = await abrir(browser, base, S, A);
    await pa.click('[data-cm]');
    const vis = await pa.evaluate(() => ({ nota: [...document.querySelectorAll('.card .txt')].map(e => e.innerText), ws: getComputedStyle(document.querySelector('.card .txt')).whiteSpace }));
    exige(vis.ws === 'pre-wrap', 'white-space ' + vis.ws);
    exige(vis.nota.includes(antigo), 'reflexão antiga mudou: ' + JSON.stringify(vis.nota));
    exige(vis.nota.includes('Amém!\nQue palavra.\n\nObrigado.'), 'comentário antigo mudou: ' + JSON.stringify(vis.nota));
    // novo comentário e nova publicação
    await pa.fill('[id^=ci-]', 'Linha 1\nLinha 2\n\nLinha 4'); await pa.click('[data-cs]');
    await esperar(() => Object.keys(S.DB.comments).length === 2);
    const novoCm = Object.values(S.DB.comments).find(x => x.id !== 'c1').body;
    await pa.click('#add'); await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.click('[data-mn="15"]'); await pa.fill('#t', '  Deus é fiel.\nEle cuida.\n\n\nAmém.\n');
    await pa.click('#ok'); await esperar(() => Object.values(S.DB.checkins).some(x => x.user_id === A.id));
    const nova = Object.values(S.DB.checkins).find(x => x.user_id === A.id).note;
    await recarregar(pa);
    const tela = await pa.evaluate(() => [...document.querySelectorAll('.card .txt')].map(e => e.innerText));
    await pa.context().close();
    exige(novoCm === 'Linha 1\nLinha 2\n\nLinha 4', 'comentário salvo como ' + JSON.stringify(novoCm));
    exige(nova === '  Deus é fiel.\nEle cuida.\n\n\nAmém.', 'reflexão salva como ' + JSON.stringify(nova));
    exige(tela.includes(nova), 'reflexão nova na tela: ' + JSON.stringify(tela));
    return 'quebras, linhas em branco e recuo preservados';
  });

  await teste('Áudio gravado no app: aparece com tocador na publicação e para os outros', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add'); await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.click('#rgo'); await pa.waitForSelector('#rstop'); await new Promise(r => setTimeout(r, 2300));
    const relogio = await pa.textContent('#rect');
    await pa.click('#rstop'); await pa.waitForSelector('#mprev .aud audio');
    await pa.click('[data-mn="10"]'); await pa.click('#ok');
    await esperar(() => Object.keys(S.DB.checkins).length === 1);
    const k = Object.values(S.DB.checkins)[0], partes = (k && k.photo_path || '').split('|');
    const aud = partes.find(x => /\.(weba|m4a|ogg)$/.test(x));
    exige(partes.length === 2 && aud, 'gravou ' + (k && k.photo_path));
    exige(k.media_type === 'image', 'tipo da publicação virou ' + k.media_type);
    const pb = await abrir(browser, base, S, B);
    const nb = await pb.$$eval('.aud audio', a => a.length), imgs = await pb.$$eval('.card img.media', a => a.length);
    await pa.context().close(); await pb.context().close();
    exige(nb === 1 && imgs === 1, 'o outro integrante vê ' + nb + ' áudio(s) e ' + imgs + ' foto(s)');
    return 'cronômetro mostrou ' + relogio + '; arquivo ' + aud.split('.').pop() + ' de ' + Math.round(S.DB.objects[aud].size / 1024) + ' KB';
  });

  await teste('Gravação para sozinha no limite de 3 minutos', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.evaluate(() => { MAXAUD = 2 }); // 3 minutos viram 2 segundos no teste
    await pa.click('#add'); await pa.click('#rgo');
    const parou = await esperar(async () => !!(await pa.$('#mprev .aud audio')), 6000);
    const gravando = !!(await pa.$('#rstop'));
    await pa.context().close();
    exige(parou && !gravando, 'não parou sozinha');
  });

  await teste('Áudio do celular com mais de 3 minutos é recusado; só áudio sem foto pede foto', async () => {
    const S = novoServidor(); const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add');
    await pa.evaluate(() => { vidDur = () => Promise.resolve(200) });
    await pa.setInputFiles('#faud', { name: 'longo.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(3000) });
    await esperar(async () => /3 minutos/.test(await pa.textContent('#er')));
    const m1 = await pa.textContent('#er'), n1 = await pa.$$eval('#mprev .aud', a => a.length);
    await pa.evaluate(() => { vidDur = () => Promise.resolve(95) });
    await pa.setInputFiles('#faud', { name: 'curto.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(3000) });
    await pa.waitForSelector('#mprev .aud');
    await pa.click('[data-mn="10"]'); await pa.click('#ok');
    const m2 = await pa.textContent('#er');
    await pa.context().close();
    exige(/3:20/.test(m1) && n1 === 0, 'aceitou o longo: ' + m1);
    exige(/foto ou vídeo/.test(m2) && Object.keys(S.DB.checkins).length === 0, 'publicou só com áudio: ' + m2);
    return m1;
  });

  // ---------- 6. Regressão ----------
  await teste('Funções que já existiam continuam: editar publicação, Amém, comentário, chat, trocar de jornada', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g);
    const c1 = S.jornada(g, 'Romanos em 16 dias'), c2 = S.jornada(g, 'Salmos em 30 dias');
    const k = S.publicacao(B, c1, { photo_path: B.id + '/x.jpg' }); S.DB.objects[B.id + '/x.jpg'] = { size: 1 };
    const pb = await abrir(browser, base, S, B, {}), pa = await abrir(browser, base, S, A);
    await pa.evaluate(id => { S.cur = id; useCur(); render() }, c1.id);
    await pa.click('[data-l]'); await esperar(() => S.DB.likes.length === 1);
    await pa.click('[data-cm]'); await pa.fill('[id^=ci-]', 'Amém, irmão!'); await pa.click('[data-cs]');
    await esperar(() => Object.keys(S.DB.comments).length === 1);
    await pa.click('nav [data-t="chat"]'); await pa.fill('#cin', 'Olá caravana'); await pa.click('#csend');
    await esperar(() => Object.keys(S.DB.messages).length === 1);
    await pb.evaluate(id => { S.cur = id; useCur(); render() }, c1.id); await recarregar(pb);
    await pb.click('[data-ep]'); await pb.waitForSelector('#mn'); await pb.fill('#mn', '33'); await pb.click('#ok');
    await esperar(() => S.DB.checkins[k.id].study_minutes === 33);
    exige(S.DB.checkins[k.id].study_minutes === 33, 'edição não salvou');
    const errs = pa.erros.concat(pb.erros);
    await pa.context().close(); await pb.context().close();
    exige(errs.length === 0, errs.join(' | '));
  });

  await browser.close(); srv.close();
  const ok = resultados.filter(r => r.ok).length;
  console.log('\n' + ok + ' de ' + resultados.length + ' testes passaram');
  fs.writeFileSync(path.join(__dirname, 'resultado-' + path.basename(HTML, '.html') + '.json'), JSON.stringify(resultados, null, 1));
  process.exit(ok === resultados.length ? 0 : 1);
})();
