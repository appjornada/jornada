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
      if (u.startsWith('/img/')) return setTimeout(() => { rsp.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }); rsp.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#c96"/></svg>') }, 350); // foto com atraso de rede
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
// Marca os capítulos sugeridos (nada vem marcado sozinho); sem sugestão, marca o primeiro livre
async function marcar(pg) {
  if (await pg.$('#selsug')) return pg.click('#selsug');
  const c = await pg.$('#chg .chip:not([disabled]):not(.on)'); if (c) await c.click();
}
async function darPasso(pg, opts = {}) {
  await pg.evaluate(() => { closeSheet(); tab = 'feed'; render() });
  await pg.click('#add');
  await pg.waitForSelector('#fgal', { state: 'attached' });
  await pg.setInputFiles('#fgal', { name: (opts.foto || 'foto') + '.png', mimeType: 'image/png', buffer: opts.buffer || PNG });
  await pg.waitForSelector('.mth');
  await marcar(pg);
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
  const srv = await servirApp(), base = 'http://localhost:' + srv.address().port; global.IMG = base + '/img/';
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
      exige(/Participantes \(6\)/.test(await pg.textContent('main')), 'não mostra 6 participantes');
      await pg.click('main [data-mball]'); await pg.click('main [data-rkall]'); // abre a lista e o ranking completo
      const t = await pg.textContent('main');
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
    await pb.click('main [data-mball]'); await pb.click('[data-leave]'); await esperar(() => S.DB.gm.length === 2);
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

  await teste('Só quem está na lista cria caravana ou jornada; os outros entram só com o código', async () => {
    const S = novoServidor();
    const M = S.usuario('Mayara'), V = S.usuario('Vó Andrea'), Gi = S.usuario('Gizela');
    S.criador(M);
    const g = S.caravana(M, 'Tiago'); S.jornada(g, 'Tiago em 5 dias');
    const g2 = S.caravana(Gi, 'Bíblia'); S.jornada(g2, 'Romanos em 16 dias'); // líder que criou antes da regra
    // pessoa sem caravana: boas-vindas só com o código
    const pv = await abrir(browser, base, S, V);
    await pv.waitForSelector('#shc [data-o="code"]');
    exige(!(await pv.$('#shc [data-o="new"]')), 'boas-vindas ainda oferece começar a própria jornada');
    exige(/código de convite/.test(await pv.textContent('#shc')), 'boas-vindas não fala do código');
    await pv.evaluate(() => onb('new')); exige(await pv.$('#ocode'), 'tela de roteiros abriu mesmo sem permissão');
    await pv.evaluate(() => { closeSheet(); tab = 'cfg'; render() });
    exige(!(await pv.$('main [data-o="new"]')), 'Mapa ainda oferece começar jornada');
    exige((await S.handle(V.id, { rpc: 'create_group', args: { p_name: 'Sem querer' } })).error, 'servidor deixou criar caravana');
    await pv.evaluate(() => onb('code')); await pv.fill('#ocode', g.invite_code); await pv.click('#oj');
    exige(await esperar(() => S.member(V.id, g.id)), 'não entrou com o código');
    await esperar(() => pv.evaluate(() => S.chs.length === 1));
    // líder fora da lista: edita a jornada que já tem, mas não cria outra
    const pg = await abrir(browser, base, S, Gi);
    await pg.click('nav [data-t="cfg"]');
    exige(!(await pg.$('#fc')) && !(await pg.$('main [data-o="new"]')), 'líder fora da lista vê como criar');
    exige(await pg.$('[data-ed]'), 'líder perdeu o Editar da jornada');
    // Mayara: vê tudo para criar
    const pm = await abrir(browser, base, S, M);
    await pm.click('nav [data-t="cfg"]');
    exige(await pm.$('#fc') && await pm.$('main [data-o="new"]'), 'Mayara não vê como criar');
    await Promise.all([pv, pg, pm].map(p => p.context().close()));
    // banco sem a regra (desfeita): volta como antes, todos podem começar
    const S2 = novoServidor({ semListaCriadores: true }), A = S2.usuario('Ana');
    const pa = await abrir(browser, base, S2, A);
    await pa.waitForSelector('#shc [data-o="new"]', { timeout: 4000 }).catch(() => {});
    const livre = !!(await pa.$('#shc [data-o="new"]')); await pa.context().close();
    exige(livre, 'sem a regra no banco, ninguém consegue começar');
    return 'sem caravana: só código (e entrou); líder antiga: só edita; Mayara: cria';
  });

  await teste('Foto de perfil: escolher, aparecer para a caravana no lugar da letra, trocar e tirar', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bia');
    const g = S.caravana(A, 'Tiago'); S.entrar(B, g); const c = S.jornada(g, 'Tiago em 5 dias');
    S.publicacao(A, c); S.publicacao(B, c);
    const pa = await abrir(browser, base, S, A);
    pa.on('dialog', d => d.accept());
    // sem foto: a letra no mural e o convite no alto do Mapa
    await pa.waitForSelector('main .card .av.md');
    exige(!(await pa.$('main .av img')), 'apareceu foto sem ninguém ter colocado');
    await pa.click('nav [data-t="cfg"]'); await pa.waitForSelector('main [data-avp]');
    exige((await pa.textContent('main .card')).includes('Sua foto de perfil'), 'o convite para pôr a foto não está no alto do Mapa');
    // escolhe uma foto em pé (600x900): vira um quadrado pequeno
    const gera = cor => pa.evaluate(k => { const v = document.createElement('canvas'); v.width = 600; v.height = 900; const x = v.getContext('2d'); x.fillStyle = k; x.fillRect(0, 0, 600, 900); return v.toDataURL('image/png').split(',')[1] }, cor).then(b => Buffer.from(b, 'base64'));
    await pa.setInputFiles('#favt', { name: 'eu.png', mimeType: 'image/png', buffer: await gera('#2a6') });
    exige(await esperar(() => S.DB.profiles[A.id].avatar_path), 'a foto não foi salva no perfil');
    const p1 = S.DB.profiles[A.id].avatar_path;
    exige(new RegExp('^' + A.id + '/avatar-[0-9a-f]{16}\\.jpg$').test(p1) && S.DB.objects[p1], 'caminho da foto errado: ' + p1);
    exige(S.DB.objects[p1].size < 60000, 'foto grande demais: ' + S.DB.objects[p1].size + ' bytes');
    await pa.waitForSelector('main .av.big img');
    exige(await pa.$('main [data-avdel]'), 'sem o botão de tirar a foto');
    // Bia vê a foto da Ana no mural e no ranking; a dela continua com a letra
    const pb = await abrir(browser, base, S, B);
    const circ = (pg, nome, sel) => pg.evaluate(([n, s]) => { const r = [...document.querySelectorAll(s)].find(x => [...x.querySelectorAll('b')].some(b => b.textContent.replace(' (você)', '') === n)); const a = r && r.querySelector('.av'); return a ? { foto: !!a.querySelector('img'), letra: a.firstChild.nodeValue } : null }, [nome, sel]);
    await esperar(async () => (await circ(pb, 'Ana', 'main .card')) && (await circ(pb, 'Ana', 'main .card')).foto);
    const fa = await circ(pb, 'Ana', 'main .card'), fb = await circ(pb, 'Bia', 'main .card');
    exige(fa && fa.foto, 'Bia não vê a foto da Ana no mural');
    exige(fb && !fb.foto && fb.letra === 'B', 'a publicação da Bia perdeu a letra');
    await pb.click('nav [data-t="cfg"]'); await pb.waitForSelector('main .rk');
    exige((await circ(pb, 'Ana', 'main .rk')).foto, 'Bia não vê a foto da Ana no ranking');
    // trocar: a foto antiga é apagada do armazenamento
    await pa.setInputFiles('#favt', { name: 'eu2.png', mimeType: 'image/png', buffer: await gera('#a26') });
    exige(await esperar(() => S.DB.profiles[A.id].avatar_path !== p1), 'não trocou a foto');
    exige(await esperar(() => !S.DB.objects[p1]), 'a foto antiga ficou guardada');
    const p2 = S.DB.profiles[A.id].avatar_path;
    // tirar: volta a letra
    await pa.click('main [data-avdel]');
    exige(await esperar(() => S.DB.profiles[A.id].avatar_path == null), 'não tirou a foto');
    exige(await esperar(() => !S.DB.objects[p2]), 'o arquivo da foto ficou guardado');
    await pa.waitForSelector('main .av.big:not(:has(img))');
    exige((await pa.textContent('main .av.big')).trim() === 'A', 'não voltou a letra');
    await Promise.all([pa, pb].map(p => p.context().close()));
    // banco ainda sem o campo da foto: tudo como antes (nomes aparecem, sem oferecer a foto)
    const S2 = novoServidor({ semAvatar: true }), C1 = S2.usuario('Caio'), g2 = S2.caravana(C1, 'X'); S2.publicacao(C1, S2.jornada(g2, 'J'));
    const pc = await abrir(browser, base, S2, C1);
    await pc.waitForSelector('main .card .av.md');
    const nomeOk = (await pc.textContent('main')).includes('Caio');
    await pc.click('nav [data-t="cfg"]'); await pc.waitForSelector('main .rk');
    const semFoto = !(await pc.$('[data-avp]')); await pc.context().close();
    exige(nomeOk, 'sem o campo no banco, os nomes sumiram');
    exige(semFoto, 'sem o campo no banco, ofereceu a foto');
    return 'Ana pôs, Bia viu no mural e no ranking, trocou (antiga apagada), tirou (voltou a letra); sem o campo: como antes';
  });

  await teste('Vídeo grande fica menor antes de enviar (com som e na duração certa); se não der, vai o original', async () => {
    const { execFileSync } = require('child_process'), os = require('os');
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch (e) { return 'pulado: este computador não tem ffmpeg' }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-')), ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    // vídeo em pé de 15 s com som, pesado como o do celular (o Chromium dos testes só lê WebM)
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=15,noise=alls=12:allf=t', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15', '-c:v', 'libvpx', '-b:v', '9M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', path.join(dir, 'celular.webm'));
    const orig = fs.readFileSync(path.join(dir, 'celular.webm'));
    const S = novoServidor(), U = S.usuario('Ana'), g = S.caravana(U, 'Tiago'); S.jornada(g, 'Tiago em 5 dias');
    const postar = async (pg, tipos) => {
      await pg.evaluate(t => { VZ.types = t; VZ.mp4only = false; VZ.min = 1048576; // o Chromium dos testes não grava H.264: aqui vale WebM; converte a partir de 1 MB
        const of = sb.storage.from.bind(sb.storage); sb.storage.from = b => { const o = of(b), up = o.upload; o.upload = (p, bl, op) => { if (/\.(webm|mp4)$/.test(p)) window.__vid = bl; return up(p, bl, op) }; return o } }, tipos);
      await pg.evaluate(() => { closeSheet(); tab = 'feed'; render() }); await pg.click('#add');
      await pg.waitForSelector('#fgal', { state: 'attached' });
      await pg.setInputFiles('#fgal', { name: 'celular.webm', mimeType: 'video/webm', buffer: orig });
      await pg.waitForSelector('.mth'); await marcar(pg); await pg.click('[data-mn="15"]'); await pg.click('#ok');
    };
    // 1) converte: mostra o andamento e envia um arquivo bem menor
    const pg = await abrir(browser, base, S, U);
    await postar(pg, ['video/webm;codecs=vp8,opus']);
    exige(await esperar(() => pg.evaluate(() => /Preparando o vídeo… \d+%/.test((document.getElementById('ok') || {}).textContent || '')), 8000), 'não mostrou "Preparando o vídeo…"');
    exige(await esperar(() => Object.values(S.DB.checkins).some(k => /\.webm$/.test(k.photo_path || '')), 40000), 'a publicação com vídeo não foi salva');
    const k = Object.values(S.DB.checkins).find(x => /\.webm$/.test(x.photo_path || '')), env = S.DB.objects[k.photo_path].size;
    exige(env < orig.length * 0.4, 'o vídeo não diminuiu: ' + orig.length + ' → ' + env + ' bytes');
    // capa do vídeo e arquivos marcados para o celular guardar
    const capa = k.photo_path.replace(/\.[^.\/]+$/, '.t.jpg');
    exige(await esperar(() => S.DB.objects[capa]), 'o vídeo ficou sem capa');
    exige(S.DB.objects[k.photo_path].cache === '31536000' && S.DB.objects[capa].cache === '31536000', 'arquivos sem a marca de guardar no celular');
    await recarregar(pg); await pg.evaluate(() => { tab = 'feed'; render() });
    const vat = await pg.$eval('main video.media', v => ({ pre: v.getAttribute('preload'), capa: !!v.getAttribute('poster') }));
    exige(vat.capa && vat.pre === 'none', 'o vídeo no mural não usa a capa (baixaria o vídeo sem ninguém tocar): ' + JSON.stringify(vat));
    const b64 = await pg.evaluate(async () => { const b = new Uint8Array(await window.__vid.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s) });
    const out = path.join(dir, 'enviado.webm'); fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    // o MediaRecorder não grava a duração no WebM: o ffmpeg conta os quadros
    const r = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const tempo = [...r.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop(), seg = tempo ? +tempo[1] * 3600 + +tempo[2] * 60 + +tempo[3] : 0;
    const tam = r.match(/Video: \w+.*?, (\d+)x(\d+)/), vol = r.match(/mean_volume: (-?[\d.]+) dB/);
    exige(seg > 13.5 && seg < 17, 'duração errada: ' + seg + ' s');
    exige(tam && +tam[1] <= 720 && +tam[2] <= 1280 && +tam[2] > +tam[1], 'tamanho da imagem errado: ' + (tam && tam[0]));
    exige(vol && +vol[1] > -40, 'o som não foi gravado: ' + (vol ? vol[1] + ' dB' : 'sem faixa de áudio'));
    await pg.context().close();
    // 2) aparelho que não consegue converter: vai o original, como antes
    const S2 = novoServidor(), U2 = S2.usuario('Bia'), g2 = S2.caravana(U2, 'Tiago'); S2.jornada(g2, 'Tiago em 5 dias');
    const p2 = await abrir(browser, base, S2, U2);
    await postar(p2, ['video/x-nenhum']);
    exige(await esperar(() => Object.values(S2.DB.checkins).some(k => /\.webm$/.test(k.photo_path || '')), 15000), 'sem conversão, a publicação não foi salva');
    const k2 = Object.values(S2.DB.checkins).find(x => /\.webm$/.test(x.photo_path || ''));
    exige(S2.DB.objects[k2.photo_path].size === orig.length, 'sem conversão, não foi o original');
    // 3) a conferência de formato: só passa MP4 com H.264 e AAC (o que o iPhone toca)
    const amostra = (nome, ...a) => { ff('-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=2', ...a, path.join(dir, nome)); return fs.readFileSync(path.join(dir, nome)).toString('base64') };
    const sine = ['-f', 'lavfi', '-i', 'sine=duration=2'];
    const casos = { 'h264-fragmentado': amostra('a.mp4', ...sine, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov'),
      'h264-normal': amostra('b.mp4', ...sine, '-c:v', 'libx264', '-c:a', 'aac'), 'vp9-opus': amostra('c.mp4', ...sine, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus', '-movflags', 'frag_keyframe+empty_moov'),
      'webm': amostra('d.webm', ...sine, '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus') };
    const res = await p2.evaluate(async c => { const o = {}; for (const [n, b] of Object.entries(c)) { const x = await vzCodecs(new Blob([Uint8Array.from(atob(b), ch => ch.charCodeAt(0))])); o[n] = x.mp4 && x.v && x.a && !x.bad } return o }, casos);
    await p2.context().close(); fs.rmSync(dir, { recursive: true, force: true });
    exige(res['h264-fragmentado'] && res['h264-normal'], 'recusou um MP4 H.264/AAC: ' + JSON.stringify(res));
    exige(!res['vp9-opus'] && !res.webm, 'aceitou um formato que o iPhone não toca: ' + JSON.stringify(res));
    return (orig.length / 1048576).toFixed(1) + ' MB → ' + (env / 1048576).toFixed(1) + ' MB, ' + seg.toFixed(1) + ' s, ' + tam[1] + 'x' + tam[2] + ', som ' + vol[1] + ' dB; sem suporte: original; formatos: ' + JSON.stringify(res);
  });

  await teste('Economia de dados: miniaturas das fotos antigas, links guardados, atualização só do que mudou e chat incremental', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bia');
    const g = S.caravana(A, 'Tiago'); S.entrar(B, g); const c = S.jornada(g, 'Tiago em 5 dias');
    // fotos antigas (nome sem impressão digital) sem miniatura: uma da Ana, uma da Bia
    const fa = A.id + '/1794067783651-1wp5b1.jpg', fb = B.id + '/1794012953806-4fnany.jpg';
    S.DB.objects[fa] = { size: 4000000 }; S.DB.objects[fb] = { size: 4000000 };
    S.publicacao(A, c, { photo_path: fa }); S.publicacao(B, c, { photo_path: fb });
    const tA = fa.replace('.jpg', '.t.jpg'), tB = fb.replace('.jpg', '.t.jpg');
    // 1) o app da Ana cria a miniatura só da foto dela
    const pa = await abrir(browser, base, S, A);
    exige(await esperar(() => S.DB.objects[tA], 10000), 'o app da dona não criou a miniatura');
    exige(S.DB.objects[tA].cache === '31536000' && S.DB.objects[tA].size < 200000, 'miniatura grande ou sem a marca de guardar: ' + JSON.stringify(S.DB.objects[tA]));
    exige(!S.DB.objects[tB], 'o app da Ana mexeu na foto da Bia');
    // 2) a Bia vê a miniatura da Ana (não a foto inteira) e o app dela cria a da própria foto
    const pb = await abrir(browser, base, S, B);
    exige(await esperar(() => S.DB.objects[tB], 10000), 'o app da Bia não criou a miniatura dela');
    const srcA = await pb.evaluate(n => { const c = [...document.querySelectorAll('main .card')].find(x => x.querySelector('b') && x.querySelector('b').textContent === n); const i = c && c.querySelector('img.media'); return i ? i.getAttribute('src') : '' }, 'Ana');
    exige(srcA.endsWith(tA), 'a Bia baixa a foto inteira da Ana em vez da miniatura: ' + srcA.slice(-60));
    // 3) links guardados: ao abrir o app de novo, não pede links novos para o que já tem
    await recarregar(pb); // pega o link da miniatura que o app da Bia acabou de criar
    await pb.evaluate(() => new Promise(r => setTimeout(r, 700))); // links salvos no aparelho
    const n0 = S.log.length; await pb.reload();
    await pb.waitForFunction(() => typeof loaded !== 'undefined' && loaded, null, { timeout: 15000 });
    await pb.evaluate(() => new Promise(r => setTimeout(r, 300)));
    const pedidos = S.log.slice(n0).filter(x => x.me === B.id && x.op === 'sign').length;
    exige(pedidos === 0, 'ao reabrir, pediu ' + pedidos + ' vez(es) links de fotos que já tinha');
    // 4) atualização leve: sem novidade, não baixa as publicações; com novidade, baixa e mostra
    exige(await esperar(() => pb.evaluate(() => !!FV)), 'não guardou a impressão digital');
    const n1 = S.log.length; await pb.evaluate(() => poll()); await pb.evaluate(() => poll());
    const baixou = S.log.slice(n1).filter(x => x.me === B.id && x.t === 'checkins' && x.op === 'select').length;
    const perguntou = S.log.slice(n1).filter(x => x.me === B.id && x.t === 'feed_version').length;
    exige(baixou === 0 && perguntou === 2, 'sem novidade, baixou as publicações ' + baixou + ' vez(es) (perguntou ' + perguntou + ')');
    S.publicacao(A, c, { book: 'Tiago', ref: '4', note: 'Novidade da Ana', photo_path: null, media_type: null });
    await pb.evaluate(() => poll());
    exige(await esperar(() => pb.evaluate(() => document.querySelector('main').textContent.includes('Novidade da Ana'))), 'a novidade não apareceu');
    // 5) chat: depois da primeira vez, só pede as mensagens novas
    const msg = (u, body, s) => { const m = { id: require('crypto').randomUUID(), challenge_id: c.id, user_id: u.id, body, created_at: new Date(Date.now() - s * 1000).toISOString() }; S.DB.messages[m.id] = m };
    msg(A, 'Bom dia, caravana!', 60); msg(B, 'Bom dia!', 30);
    await pb.click('nav [data-t="chat"]');
    exige(await esperar(() => pb.evaluate(() => (document.getElementById('msgs') || {}).textContent.includes('Bom dia, caravana!'))), 'o chat não abriu');
    const n2 = S.log.length; msg(A, 'Vamos orar às 20h', 0); await pb.evaluate(() => loadChat());
    exige(await esperar(() => pb.evaluate(() => document.getElementById('msgs').textContent.includes('Vamos orar às 20h'))), 'a mensagem nova não apareceu');
    const cq = S.log.slice(n2).filter(x => x.t === 'messages' && x.op === 'select');
    exige(cq.length && cq.every(x => /gte/.test(x.f)), 'o chat baixou a conversa toda de novo: ' + JSON.stringify(cq));
    exige((await pb.evaluate(() => document.getElementById('msgs').textContent.split('Bom dia, caravana!').length - 1)) === 1, 'mensagem repetida no chat');
    await Promise.all([pa, pb].map(p => p.context().close()));
    // 6) banco sem a função: baixa tudo a cada vez, como antes
    const S2 = novoServidor({ semVersao: true }), C1 = S2.usuario('Caio'), g2 = S2.caravana(C1, 'X'); S2.publicacao(C1, S2.jornada(g2, 'J'));
    const pc = await abrir(browser, base, S2, C1); const n3 = S2.log.length;
    await pc.evaluate(() => poll()); await pc.evaluate(() => poll());
    const tudo = S2.log.slice(n3).filter(x => x.t === 'checkins' && x.op === 'select').length; await pc.context().close();
    exige(tudo >= 2, 'sem a função no banco, parou de atualizar');
    return 'miniaturas criadas pelas donas; Bia vê a miniatura; reabrir: 0 links novos; sem novidade: só a pergunta; chat: só as novas; sem a função: como antes';
  });

  await teste('Mapa: ranking mostra os 3 primeiros e a trilha os 5; participantes só o número até tocar', async () => {
    const S = novoServidor();
    const nomes = ['Mayara', 'Bia', 'Caio', 'Davi', 'Eva', 'Fábio', 'Gil', 'Roger'];
    const U = nomes.map(n => S.usuario(n)), g = S.caravana(U[0], 'Tiago'); U.slice(1).forEach(u => S.entrar(u, g));
    const c = S.jornada(g, 'João em 21 dias');
    U.forEach((u, i) => { for (let k = 1; k <= 8 - i; k++) S.publicacao(u, c, { book: 'João', ref: String(k), chapters: 1 }) }); // Mayara 8 passos … Roger 1
    const pg = await abrir(browser, base, S, U[7]); // Roger, o último
    await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('main [data-rkall]');
    const ver = () => pg.evaluate(() => {
      const card = [...document.querySelectorAll('main .card')].find(x => x.textContent.includes('A caravana'));
      const pc = [...document.querySelectorAll('main .card')].find(x => x.textContent.includes('Participantes'));
      return { rank: [...card.querySelectorAll('.rk .grow b')].map(b => b.textContent), pos: [...card.querySelectorAll('.rk .pos')].map(b => b.textContent),
        peers: document.querySelectorAll('#map .peer').length, part: pc.querySelector('b').textContent, lista: pc.querySelectorAll('.rk').length,
        sair: !!document.querySelector('[data-leave]'), botao: card.querySelector('[data-rkall]').textContent };
    });
    let v = await ver();
    exige(v.rank.slice(0, 3).join() === 'Mayara,Bia,Caio', 'ranking não mostra os 3 primeiros: ' + v.rank.join());
    exige(v.rank.length === 4 && v.rank[3] === 'Roger (você)' && v.pos[3] === '8', 'a própria posição não aparece embaixo: ' + v.rank.join() + ' / ' + v.pos.join());
    exige(v.peers <= 5, 'a trilha mostra ' + v.peers + ' pessoas (devia mostrar no máximo 5)');
    exige(/Ver ranking completo \(8\)/.test(v.botao), 'botão: ' + v.botao);
    exige(v.part === '👥 Participantes (8)' && v.lista === 0 && !v.sair, 'participantes já aparecem listados: ' + JSON.stringify(v));
    await pg.click('main [data-rkall]'); v = await ver();
    exige(v.rank.length === 8 && v.peers === 7, 'ranking completo: ' + v.rank.length + ' no ranking, ' + v.peers + ' na trilha');
    await pg.click('main [data-mball]'); v = await ver();
    exige(v.lista === 8 && v.sair, 'ao tocar, a lista de participantes não abriu: ' + v.lista);
    await pg.click('main [data-rkall]'); await pg.click('main [data-mball]'); v = await ver();
    exige(v.rank.length === 4 && v.lista === 0, 'não fechou de novo');
    await pg.context().close();
    return 'Roger (8º) vê os 3 primeiros + a própria posição; trilha com até 5; ranking completo: 8 e 7 na trilha; participantes: só o número até tocar';
  });

  await teste('Coroa em quem está em 1º; empatados com o 1º também ganham (e nenhum fica escondido)', async () => {
    const montar = passos => { const S = novoServidor(), U = passos.map((_, i) => S.usuario('P' + i)), g = S.caravana(U[0], 'Tiago'); U.slice(1).forEach(u => S.entrar(u, g));
      const c = S.jornada(g, 'João em 21 dias'); U.forEach((u, i) => { for (let k = 1; k <= passos[i]; k++) S.publicacao(u, c, { book: 'João', ref: String(k), chapters: 1 }) }); return { S, U } };
    const ler = pg => pg.evaluate(() => { const card = [...document.querySelectorAll('main .card')].find(x => x.textContent.includes('A caravana'));
      return [...card.querySelectorAll('.rk')].map(r => ({ n: r.querySelector('.grow b').textContent.replace(' (você)', ''), pos: r.querySelector('.pos').textContent, coroa: !!r.querySelector('.crown') })) });
    // empate em 1º: P0 e P1 com 8 passos
    let { S, U } = montar([8, 8, 7, 3, 2, 1, 1]);
    let pg = await abrir(browser, base, S, U[6]); await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('main .rk');
    let r = await ler(pg); await pg.context().close();
    const coroas = r.filter(x => x.coroa).map(x => x.n).sort().join();
    exige(coroas === 'P0,P1', 'coroas em: ' + coroas);
    exige(r[0].pos === '🥇' && r[1].pos === '🥇' && r[2].pos === '🥉' && !r[2].coroa, 'posições: ' + r.map(x => x.n + x.pos).join(' '));
    // ninguém deu passo: sem coroa
    ({ S, U } = montar([0, 0])); S.publicacao(U[0], Object.values(S.DB.challenges)[0], { book: 'Romanos', ref: '1' });
    pg = await abrir(browser, base, S, U[1]); await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('main .rk');
    r = await ler(pg); await pg.context().close();
    exige(!r.some(x => x.coroa), 'coroa sem ninguém ter dado passo');
    // 6 empatados em 1º: o ranking fechado mostra os 6
    ({ S, U } = montar([3, 3, 3, 3, 3, 3, 1, 1]));
    pg = await abrir(browser, base, S, U[7]); await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('main .rk');
    r = await ler(pg); const bt = await pg.textContent('main [data-rkall]'); await pg.context().close();
    exige(r.filter(x => x.coroa).length === 6, 'com 6 empatados, aparecem ' + r.filter(x => x.coroa).length + ' coroas');
    exige(/Ver ranking completo \(8\)/.test(bt), 'botão: ' + bt);
    return 'empate em 1º: 2 coroas e 2 ouros, o 3º fica com bronze; sem passos: sem coroa; 6 empatados: os 6 aparecem';
  });

  await teste('Sua trilha: miniatura da foto/vídeo no dia; ao tocar, abre em tela cheia', async () => {
    const S = novoServidor(), A = S.usuario('Ana'), B = S.usuario('Bia'), g = S.caravana(A, 'Tiago'); S.entrar(B, g);
    const c = S.jornada(g, 'João em 21 dias', -3, 12);
    const dia = n => { const x = new Date(); x.setDate(x.getDate() + n); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) };
    const d1 = dia(-2), d2 = dia(-1), d3 = dia(0);
    const foto = 'antigo/foto1.jpg', vid = A.id + '/' + 'a'.repeat(40) + '.mp4', capa = A.id + '/' + 'a'.repeat(40) + '.t.jpg';
    S.DB.objects[vid] = { size: 1 }; S.DB.objects[capa] = { size: 1 };
    S.publicacao(A, c, { read_date: d1, book: 'João', ref: '1', photo_path: foto, note: 'No princípio era o Verbo' });
    S.publicacao(A, c, { read_date: d2, book: 'João', ref: '2', photo_path: vid, media_type: 'video' });
    S.publicacao(B, c, { read_date: d3, book: 'João', ref: '1', photo_path: 'antigo/da-bia.jpg' }); // da Bia: não aparece na trilha da Ana
    const pg = await abrir(browser, base, S, A);
    await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('.cal');
    const cal = await pg.evaluate(() => [...document.querySelectorAll('.cal button')].map(b => ({ dv: b.dataset.dv || '', day: b.dataset.day || '', img: (b.querySelector('img') || {}).src || '', vid: b.classList.contains('vid') })));
    const c1 = cal.find(x => x.dv === d1 || x.day === d1), c2 = cal.find(x => x.dv === d2 || x.day === d2), c3 = cal.find(x => x.dv === d3 || x.day === d3);
    exige(c1 && c1.dv && /foto1\.t\.jpg$/.test(c1.img), 'dia com foto sem miniatura: ' + JSON.stringify(c1));
    exige(c2 && c2.dv && c2.vid && c2.img.endsWith('.t.jpg'), 'dia com vídeo sem a capa: ' + JSON.stringify(c2));
    exige(c3 && c3.day && !c3.dv && !c3.img, 'dia sem passo da Ana mostrou miniatura (a da Bia?): ' + JSON.stringify(c3));
    // tocar no dia com foto: abre a foto inteira (não a miniatura) com o texto
    await pg.click('.cal [data-dv="' + d1 + '"]');
    await pg.waitForSelector('#lb:not([hidden]) .lbm img');
    const lb = await pg.evaluate(() => ({ src: document.querySelector('#lb .lbm img').src, txt: document.getElementById('lb').textContent }));
    exige(/foto1\.jpg$/.test(lb.src) && !/\.t\.jpg$/.test(lb.src), 'abriu a miniatura em vez da foto: ' + lb.src);
    exige(lb.txt.includes('No princípio era o Verbo') && lb.txt.includes('João 1'), 'faltou o texto/leitura: ' + lb.txt.slice(0, 120));
    await pg.click('#lb [data-lbx]'); exige(await pg.evaluate(() => document.getElementById('lb').hidden), 'o ✕ não fechou');
    // dia com vídeo: abre o vídeo com a capa; tocar fora fecha
    await pg.click('.cal [data-dv="' + d2 + '"]'); await pg.waitForSelector('#lb:not([hidden]) video');
    exige(await pg.$eval('#lb video', v => !!v.getAttribute('poster') && v.src.endsWith('.mp4')), 'vídeo sem capa ou errado');
    await pg.keyboard.press('Escape'); exige(await pg.evaluate(() => document.getElementById('lb').hidden), 'Esc não fechou');
    // registrar mais leitura naquele dia continua possível
    await pg.click('.cal [data-dv="' + d1 + '"]'); await pg.click('#lb [data-lbday]');
    await pg.waitForSelector('#sh.show #dt'); exige((await pg.inputValue('#dt')) === d1, 'registrar mais: data errada');
    exige(await pg.evaluate(() => document.getElementById('lb').hidden && document.body.style.overflow === ''), 'o visualizador ficou aberto por baixo');
    // dia sem passo: continua abrindo o registro
    await pg.evaluate(() => closeSheet()); await pg.click('.cal [data-day="' + d3 + '"]'); await pg.waitForSelector('#sh.show #dt');
    exige((await pg.inputValue('#dt')) === d3, 'dia sem passo não abriu o registro');
    await pg.context().close();
    return 'foto e vídeo com miniatura/capa; abre a foto inteira com o texto; vídeo com capa; ✕, Esc; registrar mais no dia; dia vazio abre o registro';
  });

  await teste('Tocar no nome mostra o que a pessoa fez (mural, ranking e participantes) e abre cada passo', async () => {
    const S = novoServidor(), A = S.usuario('Ana'), B = S.usuario('Bia Souza'), C = S.usuario('Caio'), g = S.caravana(A, 'Tiago'); S.entrar(B, g); S.entrar(C, g);
    const c = S.jornada(g, 'João em 21 dias', -3, 12);
    const dia = n => { const x = new Date(); x.setDate(x.getDate() + n); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) };
    const vid = B.id + '/' + 'b'.repeat(40) + '.mp4'; S.DB.objects[vid] = { size: 1 }; S.DB.objects[vid.replace('.mp4', '.t.jpg')] = { size: 1 };
    S.publicacao(B, c, { read_date: dia(-1), book: 'João', ref: '1', photo_path: 'antigo/bia1.jpg', note: 'No princípio era o Verbo', study_minutes: 20 });
    S.publicacao(B, c, { read_date: dia(0), book: 'João', ref: '2', photo_path: vid, media_type: 'video', study_minutes: 15 });
    S.publicacao(A, c, { book: 'João', ref: '1' });
    const pg = await abrir(browser, base, S, A);
    const ficha = () => pg.evaluate(() => { const h = document.getElementById('shc'); return { aberto: document.getElementById('sh').classList.contains('show'), nome: (h.querySelector('h2') || {}).textContent || '', passos: [...h.querySelectorAll('.wp b')].map(b => b.textContent), txt: h.textContent } });
    // no mural: toca no nome da Bia
    await pg.waitForSelector('main b[data-who="' + B.id + '"]'); await pg.click('main b[data-who="' + B.id + '"]');
    let f = await ficha();
    exige(f.aberto && f.nome === 'Bia Souza', 'não abriu a ficha da Bia: ' + JSON.stringify(f).slice(0, 120));
    exige(f.passos.join() === 'João 2,João 1', 'passos da Bia (mais novo primeiro): ' + f.passos.join());
    exige(/2\s*passos/.test(f.txt) && /35 min/.test(f.txt) && /1º/.test(f.txt), 'números da Bia: ' + f.txt.slice(0, 200));
    // toca num passo: abre a mídia por cima; ao fechar, a ficha continua
    await pg.locator('#shc .wp').nth(1).click(); await pg.waitForSelector('#lb:not([hidden]) .lbm img');
    exige((await pg.textContent('#lb')).includes('No princípio era o Verbo'), 'o passo abriu sem o texto');
    exige(!(await pg.$('#lb [data-lbday]')), 'passo de outra pessoa oferece "registrar neste dia"');
    await pg.click('#lb [data-lbx]'); exige((await ficha()).aberto, 'fechar a mídia fechou a ficha');
    await pg.click('#shc #x');
    // no ranking (aba Mapa) e na lista de participantes
    await pg.click('nav [data-t="cfg"]'); await pg.waitForSelector('main .rk[data-who="' + B.id + '"]');
    await pg.click('main .rk[data-who="' + B.id + '"]'); exige((await ficha()).nome === 'Bia Souza', 'ranking não abre a ficha');
    await pg.click('#shc #x'); await pg.click('main [data-mball]');
    await pg.click('main .card:has([data-mball]) .rk[data-who="' + C.id + '"]'); f = await ficha();
    exige(f.nome === 'Caio' && /Ainda não deu passos/.test(f.txt), 'participante sem passos: ' + f.txt.slice(0, 120));
    await pg.click('#shc #x');
    // a líder (Ana) vê 🗑️ e apaga o passo de João 2 da Bia; os Amém dele vão junto
    const k2 = Object.values(S.DB.checkins).find(k => k.user_id === B.id && k.ref === '2'); S.DB.likes.push({ checkin_id: k2.id, user_id: C.id });
    await pg.click('main .rk[data-who="' + B.id + '"]'); await pg.waitForSelector('#shc [data-delpost]');
    exige((await pg.$$('#shc [data-delpost]')).length === 2, 'a líder não vê o 🗑️ em cada passo');
    pg.once('dialog', d => { exige(/Bia Souza: João 2/.test(d.message()), 'aviso: ' + d.message()); d.accept() });
    await pg.click('#shc [data-delpost="' + k2.id + '"]');
    exige(await esperar(() => !S.DB.checkins[k2.id]), 'a líder não conseguiu apagar');
    exige(!S.DB.likes.some(l => l.checkin_id === k2.id), 'o Amém do passo apagado ficou');
    exige(await esperar(() => pg.evaluate(() => [...document.querySelectorAll('#shc .wp b')].map(b => b.textContent).join() === 'João 1')), 'a ficha não atualizou depois de apagar');
    await pg.context().close();
    // participante comum: não vê o 🗑️ na ficha dos outros
    const pc = await abrir(browser, base, S, C); await pc.click('nav [data-t="cfg"]');
    await pc.waitForSelector('main .rk[data-who="' + B.id + '"]'); await pc.click('main .rk[data-who="' + B.id + '"]'); await pc.waitForSelector('#shc .wp');
    const lixo = await pc.$$('#shc [data-delpost]'); await pc.context().close();
    exige(lixo.length === 0, 'participante comum vê o 🗑️');
    return 'mural, ranking e participantes abrem a ficha; passos do mais novo para o mais antigo; tocar abre a mídia por cima; a líder apaga (com Amém), os outros não veem o 🗑️';
  });

  await teste('Início: leitura de hoje em destaque (capítulos grandes, ✓ quando lidos, atrasados à parte)', async () => {
    const S = novoServidor(), M = S.usuario('Mayara'), R = S.usuario('Roger'), g = S.caravana(M, 'Tiago'); S.entrar(R, g);
    const c = S.jornada(g, 'TIAGO + 1 JOÃO + 2 JOÃO + 3 JOÃO + 1 PEDRO + 2 PEDRO + JUDAS', -2, 8); // hoje é o dia 3 de 11
    R.md = { jornadas: [c.id] };
    const pg = await abrir(browser, base, S, R);
    const ver = () => pg.evaluate(() => { const h = document.querySelector('main .card.hoje'); return h ? { l: h.querySelector('.hj-l').textContent, t: h.querySelector('.tref').textContent,
      ch: [...h.querySelectorAll('.hj-ch .chip')].map(b => b.textContent + (b.classList.contains('ok') ? '[ok]' : '')), txt: h.textContent, primeiro: document.querySelector('main .card') === h } : null });
    let v = await ver();
    exige(v && v.primeiro, 'o destaque não é o primeiro cartão do Início');
    exige(/Leitura de hoje · dia 3 de 11/.test(v.l) && v.t === 'Tiago 5; 1 Pedro 1', 'leitura de hoje: ' + JSON.stringify(v).slice(0, 160));
    exige(v.ch.join() === 'Tiago 5,1 Pedro 1', 'capítulos: ' + v.ch.join());
    exige(/Atrasados: Tiago 1–4 \(4 capítulos\)/.test(v.txt) && !/Para ler/.test(v.txt), 'atrasados misturados com os de hoje: ' + v.txt.slice(0, 300));
    S.publicacao(R, c, { book: 'Tiago', ref: '5', chapters: 1 }); await recarregar(pg); v = await ver();
    exige(v.ch.join() === '✓ Tiago 5[ok],1 Pedro 1', 'depois de ler Tiago 5: ' + v.ch.join());
    exige(/Continuar lendo 1 Pedro 1/.test(v.txt), 'o texto não passou para o capítulo que falta');
    await pg.context().close();
    return 'dia 3 de 11: Tiago 5; 1 Pedro 1 em destaque, atrasados à parte; ✓ no lido e o texto pula para o que falta';
  });

  await teste('Pode registrar atrasados, mas não capítulos dos próximos dias (🔒 até o dia certo)', async () => {
    const S = novoServidor(), M = S.usuario('Mayara'), R = S.usuario('Roger'), g = S.caravana(M, 'Tiago'); S.entrar(R, g);
    const c = S.jornada(g, 'TIAGO + 1 JOÃO + 2 JOÃO + 3 JOÃO + 1 PEDRO + 2 PEDRO + JUDAS', -2, 8); // hoje: dia 3 (Tiago 5; 1 Pedro 1)
    R.md = { jornadas: [c.id] };
    const pg = await abrir(browser, base, S, R);
    await pg.click('#add'); await pg.waitForSelector('#chg .chip');
    const grade = () => pg.evaluate(() => [...document.querySelectorAll('#chg .chip')].map(b => b.textContent + (b.classList.contains('lk') ? '[🔒]' : '')));
    const livro = n => pg.evaluate(n => { const s = document.getElementById('sbk'); s.value = String(BOOKS.indexOf(n)); s.dispatchEvent(new Event('change', { bubbles: true })) }, n);
    let gr = await grade();
    exige(gr.join() === '1,2,3,4,5', 'Tiago (atrasados + hoje) deveria estar todo liberado: ' + gr.join());
    exige(/liberam no dia certo/.test(await pg.textContent('#stepr')), 'faltou o aviso dos próximos dias');
    await livro('1 Pedro'); gr = await grade();
    exige(gr[0] === '1' && gr.slice(1).every(x => x.endsWith('[🔒]')), '1 Pedro: só o 1 liberado hoje: ' + gr.join());
    await pg.click('#chg [data-sc$=":2"]', { force: true }); // o cadeado avisa leitores de tela; o toque mostra a explicação
    exige(/🔒 1 Pedro 2 é da leitura de/.test(await pg.textContent('#selc')), 'tocar no capítulo de amanhã não explicou (logo abaixo dos capítulos): ' + await pg.textContent('#selc'));
    exige((await pg.evaluate(() => S.sel.length)) === 0, 'marcou capítulo de amanhã');
    await livro('1 João'); gr = await grade();
    exige(gr.length === 5 && gr.every(x => x.endsWith('[🔒]')), '1 João deveria estar todo bloqueado: ' + gr.join());
    // marcar os sugeridos não pega nada à frente
    await pg.click('#selsug'); const sel = await pg.evaluate(() => ({ n: S.sel.length, ok: S.sel.every(k => !locked(k)), ref: refOf(S.sel.map(k => ({ b: +k.split(':')[0], c: +k.split(':')[1] })).sort((a, b) => a.b - b.b || a.c - b.c)) }));
    exige(sel.n === 6 && sel.ok && sel.ref === 'Tiago 1–5; 1 Pedro 1', 'sugeridos: ' + JSON.stringify(sel));
    // mesmo forçando, o Registrar recusa
    await pg.evaluate(() => { S.sel.push(BOOKS.indexOf('1 João') + ':1') }); await pg.click('#ok');
    exige(/só libera em/.test(await pg.textContent('#er')), 'o Registrar aceitou capítulo à frente: ' + await pg.textContent('#er'));
    exige(!Object.values(S.DB.checkins).some(k => k.user_id === R.id), 'salvou mesmo assim');
    // vindo da Bíblia ("Li este capítulo") num capítulo de outro dia: não marca e explica
    await pg.evaluate(() => { closeSheet(); S.preSel = BOOKS.indexOf('1 João') + ':1'; openSheet() }); await pg.waitForSelector('#chg .chip');
    exige((await pg.evaluate(() => S.sel.length)) === 0 && /é da leitura de/.test(await pg.textContent('#selc')), 'Bíblia → capítulo de outro dia não explicou');
    await pg.context().close();
    // no último dia da jornada (ou depois), tudo libera
    const pf = await abrir(browser, base, S, R, { relogio: c.end_date + 'T12:00:00' });
    await pf.click('#add'); await pf.waitForSelector('#chg .chip');
    await pf.evaluate(() => { const s = document.getElementById('sbk'); s.value = String(BOOKS.indexOf('Judas')); s.dispatchEvent(new Event('change', { bubbles: true })) });
    const gj = await pf.evaluate(() => [...document.querySelectorAll('#chg .chip')].map(b => b.classList.contains('lk')));
    await pf.context().close();
    exige(gj.length === 1 && !gj[0], 'no último dia, Judas devia estar liberado');
    return 'dia 3: Tiago todo liberado, 1 Pedro só o 1, 1 João bloqueado; tocar explica; sugeridos e Registrar respeitam; Bíblia também; último dia libera tudo';
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
    exige(/Participantes \(2\)/.test(t), 'lista: ' + t.slice(0, 80)); exige(pa.erros.length === 0, pa.erros.join());
  });

  // ---------- 3. Registro de leitura ----------
  await teste('Registro: 5 minutos existe, tempo e capítulos somam certo, capítulo repetido é bloqueado', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add'); exige(await pa.$('[data-mn="5"]'), 'sem opção de 5 minutos');
    await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await marcar(pa); await pa.click('[data-mn="5"]'); await pa.click('#ok');
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

  const JT = 'TIAGO + 1 JOÃO + 2 JOÃO + 3 JOÃO + 1 PEDRO + 2 PEDRO + JUDAS';
  await teste('Exemplo: meta de hoje Tiago 5 e 1 Pedro 1 — registra só Tiago 5 (1 passo), depois 1 Pedro 1 (+1 passo); nada vem marcado sozinho', async () => {
    const S = novoServidor();
    const A = S.usuario('Mayara'); const g = S.caravana(A, 'Tiago'); const c = S.jornada(g, JT, -2, 8); c.description = '2 capítulos por dia';
    S.publicacao(A, c, { book: 'Tiago', read_date: c.start_date, ref: '1–2', chapters: 2 }); const ontem = new Date(Date.now() - 864e5); S.publicacao(A, c, { book: 'Tiago', read_date: new Date(ontem - ontem.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), ref: '3–4', chapters: 2 });
    const pa = await abrir(browser, base, S, A);
    const antes = await pa.evaluate(() => [steps(S.me), totalSteps(S.ch)]);
    await pa.click('#add'); await pa.waitForSelector('#chg');
    const marcados = await pa.$$eval('#chg .chip.on', e => e.length), sel0 = await pa.evaluate(() => S.sel.length);
    const sug = await pa.evaluate(() => S.sug);
    await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.selectOption('#sbk', '58'); await pa.click('[data-sc="58:5"]'); await pa.click('[data-mn="15"]'); await pa.click('#ok');
    await esperar(() => Object.keys(S.DB.checkins).length === 3);
    const k3 = Object.values(S.DB.checkins).find(x => x.ref === '5');
    await esperar(async () => (await pa.evaluate(() => steps(S.me))) === 5);
    const depois1 = await pa.evaluate(() => steps(S.me)), cab1 = await pa.textContent('#cd'), txt1 = await pa.textContent('.card:has(.ref:text-is("Tiago 5"))');
    await pa.click('#add'); await pa.waitForSelector('#chg');
    await pa.setInputFiles('#fgal', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from([1])]) }); await pa.waitForSelector('.mth');
    await pa.selectOption('#sbk', '59'); await pa.click('[data-sc="59:1"]'); await pa.click('[data-mn="15"]'); await pa.click('#ok');
    await esperar(() => Object.keys(S.DB.checkins).length === 4);
    await esperar(async () => (await pa.evaluate(() => steps(S.me))) === 6);
    const depois2 = await pa.evaluate(() => steps(S.me)), status = await pa.evaluate(() => jStatus(S.ch)[0]);
    await pa.context().close();
    exige(antes[0] === 4 && antes[1] === 21, 'antes: ' + antes);
    exige(marcados === 0 && sel0 === 0, 'vieram ' + marcados + ' capítulos marcados sozinhos');
    exige(sug.join() === '58:5,59:1', 'sugestão ' + sug);
    exige(k3 && k3.chapters === 1 && k3.book === 'Tiago', 'gravou ' + JSON.stringify(k3));
    exige(depois1 === 5 && /Passo 5 de 21/.test(cab1), 'depois de Tiago 5: ' + depois1 + ' / ' + cab1);
    exige(/avançou 1 passo · passo 5/.test(txt1), 'publicação diz: ' + txt1.slice(0, 80));
    exige(depois2 === 6, 'depois de 1 Pedro 1: ' + depois2);
    return '4 → 5 → 6 passos de 21; status: ' + status;
  });

  await teste('Atrasados, capítulo repetido e constância: cada capítulo conta 1 vez; dia com 1 capítulo conta na sequência', async () => {
    const S = novoServidor();
    const A = S.usuario('Ana'), B = S.usuario('Bia'); const g = S.caravana(A, 'Tiago'); S.entrar(B, g); const c = S.jornada(g, JT, -2, 8);
    const d = n => { const x = new Date(Date.now() + n * 864e5); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) };
    // Bia: Tiago 1 registrado duas vezes (dados antigos) + 1 capítulo ontem + 1 hoje
    S.publicacao(B, c, { book: 'Tiago', read_date: d(-2), ref: '1', chapters: 1 }); S.publicacao(B, c, { book: 'Tiago', read_date: d(-1), ref: '1–2', chapters: 2 }); S.publicacao(B, c, { book: 'Tiago', read_date: d(0), ref: '3', chapters: 1 });
    const pa = await abrir(browser, base, S, A);
    const sugA = await pa.evaluate(() => { S.edit = null; return null });
    await pa.click('#add'); await pa.waitForSelector('#selsug');
    const nsug = await pa.evaluate(() => S.sug.length);
    await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.click('#selsug'); await pa.click('[data-mn="30"]'); await pa.click('#ok');
    await esperar(() => Object.values(S.DB.checkins).some(x => x.user_id === A.id));
    await esperar(async () => (await pa.evaluate(() => steps(S.me))) === 6);
    const r = await pa.evaluate(id => ({ a: steps(S.me), b: steps(id), seqB: streak(id), diasB: days(id).length }), B.id);
    await pa.click('nav [data-t="cfg"]');
    const rk = await pa.$$eval('.rk .grow b', e => e.map(x => x.textContent));
    await pa.context().close();
    exige(nsug === 6, 'sugestão com ' + nsug + ' capítulos (esperado: 4 atrasados + 2 de hoje)');
    exige(r.a === 6, 'Ana recuperou e ficou com ' + r.a);
    exige(r.b === 3, 'Bia (Tiago 1 repetido) ficou com ' + r.b + ' passos; esperado 3');
    exige(r.seqB === 3 && r.diasB === 3, 'constância da Bia: ' + r.seqB + ' seguidos, ' + r.diasB + ' dias');
    exige(/Ana/.test(rk[0]), 'ranking: ' + rk.slice(0, 2));
    return 'Ana 6 passos (atrasados recuperados), Bia 3 passos com 3 dias seguidos';
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
    await marcar(pa); await pa.click('[data-mn="15"]'); await pa.fill('#t', '  Deus é fiel.\nEle cuida.\n\n\nAmém.\n');
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
    await marcar(pa); await pa.click('[data-mn="10"]'); await pa.click('#ok');
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

  await teste('Áudio publica mesmo com o armazenamento aceitando só fotos e vídeos (como o do app hoje)', async () => {
    const S = novoServidor({ tipos: ['image/*', 'video/*'] });
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add'); await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.evaluate(() => { vidDur = () => Promise.resolve(127) }); // 2:07, como o do celular
    await pa.setInputFiles('#faud', { name: 'Gravação.m4a', mimeType: 'audio/x-m4a', buffer: Buffer.alloc(40000, 7) });
    await pa.waitForSelector('#mprev .aud');
    await marcar(pa); await pa.click('[data-mn="10"]'); await pa.click('#ok');
    const ok = await esperar(() => Object.keys(S.DB.checkins).length === 1, 8000);
    const er = await pa.textContent('#er').catch(() => '');
    const k = Object.values(S.DB.checkins)[0], aud = k && k.photo_path.split('|').find(isA => /\.m4a$/.test(isA));
    const nAud = await pa.$$eval('.card .aud audio', a => a.length);
    await pa.context().close();
    exige(ok, 'não publicou: ' + er);
    exige(aud && S.DB.objects[aud], 'áudio não ficou guardado');
    exige(nAud === 1, 'tocador não apareceu');
    return 'recusado como áudio, enviado como vídeo MP4 e mostrado como áudio';
  });

  await teste('Áudio publica quando o armazenamento só aceita vídeo .mov (formato do iPhone)', async () => {
    const S = novoServidor({ tipos: ['image/jpeg', 'image/png', 'video/quicktime'] });
    const A = S.usuario('Ana'); const g = S.caravana(A, 'G'); S.jornada(g, 'Romanos em 16 dias');
    const pa = await abrir(browser, base, S, A);
    await pa.click('#add'); await pa.setInputFiles('#fgal', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForSelector('.mth');
    await pa.evaluate(() => { vidDur = () => Promise.resolve(60) });
    await pa.setInputFiles('#faud', { name: 'voz.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(20000, 3) });
    await pa.waitForSelector('#mprev .aud'); await marcar(pa); await pa.click('[data-mn="10"]'); await pa.click('#ok');
    const ok = await esperar(() => Object.keys(S.DB.checkins).length === 1, 8000);
    await pa.context().close();
    exige(ok, 'não publicou');
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
    await marcar(pa); await pa.click('[data-mn="10"]'); await pa.click('#ok');
    const m2 = await pa.textContent('#er');
    await pa.context().close();
    exige(/3:20/.test(m1) && n1 === 0, 'aceitou o longo: ' + m1);
    exige(/foto ou vídeo/.test(m2) && Object.keys(S.DB.checkins).length === 0, 'publicou só com áudio: ' + m2);
    return m1;
  });

  await teste('Amém, abrir comentários, comentar e atualização automática não fazem a página pular', async () => {
    const S = novoServidor({ imgBase: IMG });
    const A = S.usuario('Ana'), B = S.usuario('Bruno'); const g = S.caravana(A, 'G'); S.entrar(B, g); const c = S.jornada(g, 'Romanos em 16 dias');
    for (let i = 0; i < 10; i++) { const p = B.id + '/f' + i + '.jpg'; S.DB.objects[p] = { size: 1 }; S.publicacao(B, c, { ref: String(i + 1), photo_path: p, note: 'Reflexão ' + i, created_at: new Date(Date.now() - i * 6e4).toISOString() }) }
    const pa = await abrir(browser, base, S, A);
    await pa.addStyleTag({ content: '*{overflow-anchor:none!important}' }); // como o Safari do iPhone, que não segura a posição da tela
    await pa.waitForFunction(() => [...document.querySelectorAll('img.media')].every(i => i.complete && i.naturalWidth), null, { timeout: 15000 });
    const alvo = '.card:has(.ref:text-is("Romanos 6"))';
    await pa.$eval(alvo, e => e.scrollIntoView({ block: 'center' })); await new Promise(r => setTimeout(r, 300));
    await pa.$eval(alvo + ' img.media', i => { i.__mesma = 1 });
    const pulos = [];
    const medir = async (acao, fn) => { const y0 = await pa.evaluate(() => scrollY); await fn(); await new Promise(r => setTimeout(r, 900)); const y1 = await pa.evaluate(() => scrollY); pulos.push(acao + ': ' + Math.round(y1 - y0) + ' px'); return Math.abs(y1 - y0) };
    const d1 = await medir('Amém', () => pa.click(alvo + ' [data-l]'));
    const d2 = await medir('abrir comentários', () => pa.click(alvo + ' [data-cm]'));
    await pa.fill(alvo + ' textarea', 'Que lindo!');
    const d3 = await medir('comentar', async () => { await pa.click(alvo + ' [data-cs]'); await esperar(() => Object.keys(S.DB.comments).length === 1) });
    const d4 = await medir('atualização automática', () => pa.evaluate(() => loadData()));
    const mesma = await pa.$eval(alvo + ' img.media', i => i.__mesma === 1);
    const amem = await pa.textContent(alvo + ' [data-l]'), cm = await pa.textContent(alvo + ' .cms');
    await pa.context().close();
    exige(S.DB.likes.length === 1 && /1 Amém/.test(amem), 'Amém não registrou');
    exige(/Que lindo!/.test(cm), 'comentário não apareceu');
    exige(Math.max(d1, d2, d3, d4) <= 5, 'a página pulou — ' + pulos.join(', '));
    exige(mesma, 'a foto foi recarregada');
    return pulos.join(', ') + '; a foto não recarregou';
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
