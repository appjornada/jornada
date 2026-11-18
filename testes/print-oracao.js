// Gera prints do Início com "orando agora" e as linhas de oração do dia (para mostrar o visual). Uso: node testes/print-oracao.js pasta-de-saida
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const { novoServidor, cliente } = require('./supabase-falso');
const RAIZ = path.join(__dirname, '..'), OUT = process.argv[2] || '.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((req, rsp) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u.startsWith('/storage/')) { rsp.writeHead(200, { 'content-type': 'image/svg+xml' }); return rsp.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#c9b98a"/><text x="200" y="160" font-size="28" text-anchor="middle" fill="#4a3d1a">📖 foto do estudo</text></svg>') }
    if (u === '/') { rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return rsp.end(fs.readFileSync(path.join(RAIZ, 'index.html'))) }
    const f = path.join(RAIZ, u); if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end() }
    rsp.writeHead(200); rsp.end(fs.readFileSync(f)) }).listen(0, () => res(s)) });
  const base = 'http://127.0.0.1:' + srv.address().port;
  const S = novoServidor(), R = S.usuario('Roger Martins'), M = S.usuario('Mayara Martins'), T = S.usuario('Tânia Santos'), Ro = S.usuario('Roberta Almeida'), J = S.usuario('João Pedro');
  const g = S.caravana(R, 'JORNADA'); [M, T, Ro, J].forEach(u => S.entrar(u, g));
  const c = S.jornada(g, 'Gênesis', 0, 41); R.md = { jornadas: [c.id] };
  const h = n => new Date(Date.now() - n * 6e4).toISOString();
  S.publicacao(M, c, { book: 'Gênesis', ref: '1', note: 'Uma nova jornada começa hoje!', created_at: h(90), study_minutes: 20 });
  S.publicacao(T, c, { book: 'Gênesis', ref: '1', note: 'No princípio, Deus…', created_at: h(240), study_minutes: 15 });
  const ses = (u, ini, fim) => { const id = require('crypto').randomUUID(), s = new Date(Math.floor((Date.now() - ini * 6e4) / 1000) * 1000).toISOString(), e = fim == null ? null : new Date(Date.now() - fim * 6e4).toISOString();
    S.DB.ps[id] = { id, user_id: u.id, status: e ? 'done' : 'active', started_at: s, ended_at: e, created_at: s }; S.DB.psh[id] = { session_id: id, user_id: u.id, group_id: g.id, started_at: s, ended_at: e, created_at: s } };
  const minha = require('crypto').randomUUID(), ini = new Date(Math.floor((Date.now() - 150 * 6e4) / 1000) * 1000).toISOString();
  S.DB.ps[minha] = { id: minha, user_id: R.id, status: 'done', started_at: ini, ended_at: new Date(Date.parse(ini) + 85 * 6e4).toISOString(), created_at: ini };
  ses(M, 4, null); ses(Ro, 2, null); ses(T, 60, 45); ses(J, 120, 100); ses(T, 26 * 60, 25 * 60);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'America/Sao_Paulo' });
  await ctx.exposeFunction('__api', async (me, q) => JSON.stringify(await S.handle(me, JSON.parse(q))));
  await ctx.route('**/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: cliente }));
  await ctx.route('**/auth/v1/settings', r => r.fulfill({ contentType: 'application/json', body: '{"external":{"phone":false}}' }));
  await ctx.route('https://bible-api.com/**', r => r.abort());
  await ctx.addInitScript(([id, md]) => { localStorage.setItem('fake_me', id); localStorage.setItem('fake_md', md) }, [R.id, JSON.stringify(R.md)]);
  const pg = await ctx.newPage(); await pg.goto(base + '/');
  await pg.waitForFunction(() => typeof loaded !== 'undefined' && loaded); await pg.evaluate(() => psLoad(true));
  await pg.waitForSelector('main .pslive'); await pg.waitForTimeout(800);
  await pg.screenshot({ path: path.join(OUT, 'inicio-orando-agora.png') });
  await pg.evaluate(() => document.querySelector('main .psl:not(.pslive)').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'inicio-linha-do-dia.png') });
  await pg.click('main [data-psd]'); await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(OUT, 'quem-orou-hoje.png') });
  await pg.evaluate(() => { closeSheet(true); tab = 'chat'; CV = 'ora'; render(); document.getElementById('mo').scrollIntoView({ block: 'center' }) }); await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(OUT, 'oracao-caixinha.png') });
  await pg.click('[data-mo="hist"]'); await pg.waitForSelector('#mohist [data-mo^="fix:"]'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'historico-corrigir.png') });
  await pg.click('#mohist [data-mo^="fix:"]'); await pg.fill('#mofix', '20'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'corrigir-oracao.png') });
  await browser.close(); srv.close();
})();
