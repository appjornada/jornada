// Supabase falso para os testes: um único "servidor" (no Node) compartilhado por vários navegadores,
// cada um logado como um usuário diferente. Imita as regras de acesso (RLS) do banco real,
// o limite de 1000 linhas por consulta e permite provocar falhas (internet caindo, lentidão).
// As regras seguem o diagnóstico do banco real (supabase/1-diagnostico.sql, 06/11/2026).
'use strict';
const crypto = require('crypto');
const id = () => crypto.randomUUID();
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) };

function novoServidor(opts = {}) {
  const O = Object.assign({ rosterRpc: true, maxRows: 1000, falhas: {}, atrasos: {} }, opts);
  const DB = { users: {}, profiles: {}, groups: {}, gm: [], challenges: {}, checkins: {}, likes: [], comments: {}, messages: {}, prayer_requests: {}, pi: [], ps: {}, psh: {}, objects: {}, criadores: new Set() }; // criadores: lista de quem pode criar (supabase/6-so-a-lider-cria.sql)
  const SO_LIDER = o => err('Por enquanto, só a líder pode criar ' + o + '. Peça o código de convite a ela.', '42501');
  const log = [];
  const member = (u, g) => DB.gm.some(m => m.user_id === u && m.group_id === g);
  const chGroup = c => (DB.challenges[c] || {}).group_id;

  function visible(t, me) {
    switch (t) {
      case 'group_members': return DB.gm.filter(m => member(me, m.group_id)).map(m => Object.assign({}, m, { groups: DB.groups[m.group_id] })); // gm_select: integrantes veem os vínculos da caravana
      case 'groups': return Object.values(DB.groups).filter(g => member(me, g.id));
      case 'challenges': return Object.values(DB.challenges).filter(c => member(me, c.group_id));
      case 'checkins': return Object.values(DB.checkins).filter(k => member(me, chGroup(k.challenge_id))).sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
        .map(k => Object.assign({}, k, { likes: DB.likes.filter(l => l.checkin_id === k.id).map(l => ({ user_id: l.user_id })), comments: Object.values(DB.comments).filter(c => c.checkin_id === k.id) }));
      case 'profiles': return Object.values(DB.profiles).filter(p => p.id === me || DB.gm.some(a => a.user_id === p.id && member(me, a.group_id))); // profiles_select
      case 'messages': return Object.values(DB.messages).filter(m => member(me, chGroup(m.challenge_id)));
      case 'prayer_requests': return Object.values(DB.prayer_requests).filter(r => r.user_id === me || (!r.is_private && member(me, r.group_id))) // pr_select (supabase/12-mural-de-oracao.sql)
        .map(r => Object.assign({}, r, { prayer_intercessions: DB.pi.filter(x => x.request_id === r.id).map(x => ({ user_id: x.user_id, prayed_at: x.prayed_at, praying: x.praying !== false })) }));
      case 'prayer_intercessions': { const vis = new Set(visible('prayer_requests', me).map(r => r.id)); return DB.pi.filter(x => vis.has(x.request_id)) }
      case 'prayer_sessions': return Object.values(DB.ps).filter(r => r.user_id === me).map(psOut); // ps_select: só a própria pessoa (supabase/15-meu-momento-de-oracao.sql)
      case 'prayer_shares': return Object.values(DB.psh).filter(r => r.user_id === me || member(me, r.group_id)); // psh_select
      case 'comments': return Object.values(DB.comments);
      case 'likes': return DB.likes;
      default: return [];
    }
  }
  function applyFilters(rows, f) {
    for (const [op, col, v] of f) {
      if (op === 'eq') rows = rows.filter(r => String(r[col]) === String(v));
      else if (op === 'in') rows = rows.filter(r => v.map(String).includes(String(r[col])));
      else if (op === 'is') rows = rows.filter(r => r[col] == null);
      else if (op === 'like') { const s = v.replace(/%/g, ''); rows = rows.filter(r => String(r[col] || '').includes(s)) }
      else if (op === 'gte') rows = rows.filter(r => String(r[col]) >= String(v));
      else if (op === 'gt') rows = rows.filter(r => String(r[col]) > String(v));
    }
    return rows;
  }
  const err = (message, code) => ({ data: null, error: { message, code } });
  // checkins.updated_at muda com edição, Amém e comentário (supabase/17-consumo.sql); sempre crescente, como o relógio do banco
  let ultimo = 0; const agoraMs = () => { ultimo = Math.max(Date.now(), ultimo + 1); return new Date(ultimo).toISOString() };
  const toque = cid => { if (DB.checkins[cid] && !O.semUpdatedAt) DB.checkins[cid].updated_at = agoraMs() };
  // Meu momento de oração: as mesmas regras do gatilho e das restrições do banco (supabase/15-meu-momento-de-oracao.sql)
  const sec = t => new Date(Math.floor(Date.parse(t) / 1000) * 1000).toISOString();
  const agora = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  function psOut(r) { return Object.assign({}, r, { duration_s: r.ended_at ? Math.floor((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) : null }) }
  function psCheck(r) {
    if (!['active', 'done'].includes(r.status) || (r.status === 'active') !== (r.ended_at == null)) return 'prayer_sessions_estado';
    if (r.ended_at && Date.parse(r.ended_at) <= Date.parse(r.started_at)) return 'prayer_sessions_ordem';
    if (r.ended_at && Date.parse(r.ended_at) - Date.parse(r.started_at) > 864e5) return 'prayer_sessions_maximo';
    return '';
  }
  function psDepois(op, res) { const k = 'prayer_sessions:' + op + ':depois'; if (O.falhas[k] > 0) { O.falhas[k]--; return err('Failed to fetch') } return res } // gravou, mas a resposta se perdeu
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // internet lenta: o servidor responde com os dados do momento da consulta, mas a resposta chega atrasada
  async function handle(me, q) {
    const atraso = O.atrasos[q.table + ':' + q.op], ms = atraso && atraso.shift();
    const r = await handle2(me, q);
    if (ms) await wait(ms);
    return r;
  }
  async function handle2(me, q) {
    log.push({ me, t: q.table || q.rpc || q.storage, op: q.op || (q.rpc ? 'rpc' : ''), f: (q.filters || []).map(f => f[0]).join(',') });
    const falha = O.falhas[q.table + ':' + q.op];
    if (falha && falha.length) { const f = falha.shift(); if (f === 'antes') return err('Failed to fetch'); if (f === 'travar') return new Promise(() => {}) /* app fechado: o pedido nunca chega */ }
    if (!me) return err('JWT expired');
    if (q.rpc) return rpc(me, q.rpc, q.args || {});
    if (q.storage) return storage(me, q);
    const t = q.table;
    if (q.op === 'select') {
      if (t === 'profiles' && O.semAvatar && /avatar_path/.test(q.cols || '')) return err('column profiles.avatar_path does not exist', '42703');
      if (t === 'prayer_shares' && O.pshAntigo && /ended_at/.test(q.cols || '')) return err('column prayer_shares.ended_at does not exist', '42703');
      let rows = applyFilters(visible(t, me), q.filters);
      if (q.order) { for (const o of [...q.order].reverse()) rows.sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1)) }
      let from = 0, to = rows.length - 1;
      if (q.range) [from, to] = q.range;
      if (q.limit != null) to = Math.min(to, from + q.limit - 1);
      to = Math.min(to, from + O.maxRows - 1); // o Supabase devolve no máximo 1000 por vez
      rows = rows.slice(from, to + 1);
      return q.single ? (rows.length === 1 ? { data: rows[0], error: null } : err('JSON object requested, multiple (or no) rows returned', 'PGRST116')) : { data: rows, error: null };
    }
    if (q.op === 'insert') {
      const b = Object.assign({}, q.body);
      if (t === 'checkins') {
        b.user_id = b.user_id || me;
        if (b.user_id !== me) return err('new row violates row-level security policy', '42501');
        const ch = DB.challenges[b.challenge_id];
        if (!member(me, chGroup(b.challenge_id)) || !ch || b.read_date < ch.start_date || b.read_date > ch.end_date) return err('new row violates row-level security policy for table "checkins"', '42501'); // ck_insert
        if (b.client_key && Object.values(DB.checkins).some(k => k.user_id === me && k.client_key === b.client_key)) return err('duplicate key value violates unique constraint "checkins_user_client_key"', '23505');
        if (O.semClientKey && 'client_key' in b) return err("Could not find the 'client_key' column of 'checkins' in the schema cache", 'PGRST204');
        b.id = id(); b.created_at = new Date(Date.now() + Object.keys(DB.checkins).length).toISOString(); b.updated_at = agoraMs();
        DB.checkins[b.id] = b;
        if (O.falhas['checkins:insert:depois'] > 0) { O.falhas['checkins:insert:depois']--; return new Promise(() => {}) } // gravou, mas a resposta se perdeu
        return { data: q.returning ? (q.single ? b : [b]) : null, error: null };
      }
      if (t === 'challenges') { if (!O.semListaCriadores && !DB.criadores.has(me)) return SO_LIDER('jornadas'); if (!DB.gm.some(m => m.user_id === me && m.group_id === b.group_id && m.role === 'leader')) return err('rls', '42501'); b.id = id(); DB.challenges[b.id] = b; return { data: q.single ? b : [b], error: null } }
      if (t === 'messages') { b.id = id(); b.user_id = me; b.created_at = new Date().toISOString(); DB.messages[b.id] = b; return { data: null, error: null } }
      if (t === 'comments') { b.id = id(); b.user_id = me; b.created_at = new Date().toISOString(); DB.comments[b.id] = b; toque(b.checkin_id); return { data: null, error: null } }
      if (t === 'prayer_requests') { // pr_insert
        if (!b.is_private && !member(me, b.group_id)) return err('new row violates row-level security policy for table "prayer_requests"', '42501');
        if (!b.body || b.body.length > 1500) return err('violates check constraint', '23514');
        b.id = id(); b.user_id = me; b.is_private = !!b.is_private; b.answered_at = null; b.testimony = b.testimony || null; b.created_at = new Date(Date.now() + Object.keys(DB.prayer_requests).length).toISOString();
        DB.prayer_requests[b.id] = b; return { data: q.returning ? [b] : null, error: null };
      }
      if (t === 'prayer_intercessions') { // pi_insert
        const r = DB.prayer_requests[b.request_id];
        if (!r || r.is_private || r.answered_at || r.user_id === me || !member(me, r.group_id)) return err('new row violates row-level security policy for table "prayer_intercessions"', '42501');
        if (DB.pi.some(x => x.request_id === r.id && x.user_id === me)) return err('duplicate key value violates unique constraint "prayer_intercessions_pkey"', '23505');
        DB.pi.push({ request_id: r.id, user_id: me, prayed_at: new Date().toISOString(), praying: true }); return { data: null, error: null };
      }
      if (t === 'likes') { DB.likes.push({ checkin_id: b.checkin_id, user_id: me }); toque(b.checkin_id); return { data: null, error: null } }
      if (t === 'prayer_sessions') { // ps_insert + gatilho ps_regras
        const r = { id: b.id || id(), user_id: b.user_id || me, status: b.status || 'active', started_at: sec(b.started_at), ended_at: b.ended_at ? sec(b.ended_at) : null, created_at: new Date().toISOString() };
        if (r.user_id !== me) return err('new row violates row-level security policy for table "prayer_sessions"', '42501');
        if (r.started_at > agora()) r.started_at = agora();
        if (r.ended_at && r.ended_at > agora()) r.ended_at = agora();
        if (Date.parse(r.started_at) < Date.now() - 30 * 864e5) return err('Horário de início muito antigo.', '23514');
        const c = psCheck(r); if (c) return err('new row for relation "prayer_sessions" violates check constraint "' + c + '"', '23514');
        if (DB.ps[r.id]) return err('duplicate key value violates unique constraint "prayer_sessions_pkey"', '23505');
        if (r.status === 'active' && Object.values(DB.ps).some(x => x.user_id === me && x.status === 'active')) return err('duplicate key value violates unique constraint "prayer_sessions_um_ativo"', '23505');
        DB.ps[r.id] = r; return psDepois('insert', { data: q.returning ? [psOut(r)] : null, error: null });
      }
      if (t === 'prayer_shares') { // psh_insert + gatilho psh_regras
        const sx = DB.ps[b.session_id];
        // banco novo (supabase/18-orando-na-caravana.sql): aceita também a oração em andamento; O.pshAntigo imita o banco de antes
        if (!sx || sx.user_id !== me || (O.pshAntigo && sx.status !== 'done')) return err(O.pshAntigo ? 'Só dá para compartilhar uma oração sua já concluída.' : 'Só dá para compartilhar uma oração sua.', '42501');
        if (!member(me, b.group_id)) return err('new row violates row-level security policy for table "prayer_shares"', '42501');
        if (DB.psh[b.session_id]) return err('duplicate key value violates unique constraint "prayer_shares_pkey"', '23505');
        const r = { session_id: sx.id, user_id: me, group_id: b.group_id, started_at: sx.started_at, created_at: new Date().toISOString() };
        if (!O.pshAntigo) r.ended_at = sx.ended_at || null;
        DB.psh[r.session_id] = r; return { data: q.returning ? [r] : null, error: null };
      }
      return err('tabela desconhecida');
    }
    if (q.op === 'update') {
      if (t === 'prayer_intercessions') { // pi_update: só a própria linha; o horário é sempre o do servidor (supabase/13-orando-agora.sql)
        const rows = applyFilters(DB.pi, q.filters).filter(x => x.user_id === me);
        rows.forEach(x => { if (q.body.praying === false) x.praying = false; else { x.praying = true; x.prayed_at = new Date().toISOString() } }); // 14-terminar-oracao.sql
        return { data: null, error: null };
      }
      if (t === 'prayer_sessions') { // ps_update (só status e ended_at) + gatilho: concluída não muda mais
        if (Object.keys(q.body).some(k => !['status', 'ended_at'].includes(k))) return err('permission denied for table prayer_sessions', '42501');
        const rows = applyFilters(Object.values(DB.ps).filter(r => r.user_id === me), q.filters), novos = [];
        for (const r of rows) {
          if (r.status === 'done') { novos.push(r); continue }
          const n = Object.assign({}, r, q.body); if (n.ended_at) { n.ended_at = sec(n.ended_at); if (n.ended_at > agora()) n.ended_at = agora() }
          const c = psCheck(n); if (c) return err('new row for relation "prayer_sessions" violates check constraint "' + c + '"', '23514');
          novos.push(n);
        }
        novos.forEach(n => { DB.ps[n.id] = n; if (!O.pshAntigo && DB.psh[n.id]) DB.psh[n.id].ended_at = n.ended_at || null }); // gatilho psh_fim
        return psDepois('update', { data: q.returning ? novos.map(psOut) : null, error: null });
      }
      let rows = applyFilters(visible(t, me), q.filters);
      if (t === 'checkins') { // ck_update (a própria) + ck_update_leader com a trava ck_guard_leader (supabase/11-lider-corrige-passo.sql)
        const lider = k => { const c = DB.challenges[k.challenge_id]; return !O.semLiderCorrige && c && DB.gm.some(m => m.group_id === c.group_id && m.user_id === me && m.role === 'leader') };
        rows = rows.filter(r => r.user_id === me || lider(r));
        if (rows.some(r => r.user_id !== me) && Object.keys(q.body).some(k => !['book', 'ref', 'chapters'].includes(k) && q.body[k] !== rows[0][k])) return err('A líder só pode corrigir o livro e os capítulos do passo de outra pessoa.', 'P0001');
      }
      if (t === 'profiles') {
        if (O.semAvatar && 'avatar_path' in q.body) return err("Could not find the 'avatar_path' column of 'profiles' in the schema cache", 'PGRST204');
        rows = rows.filter(r => r.id === me);
        const a = q.body.avatar_path; if (a != null && !new RegExp('^' + me + '/avatar-[0-9a-f]{8,40}\\.jpg$').test(a)) return err('new row for relation "profiles" violates check constraint "profiles_avatar_path_check"', '23514');
      }
      if (t === 'prayer_requests') { // pr_update: só o autor
        rows = rows.filter(r => r.user_id === me);
        const b = Object.assign({}, q.body); delete b.prayer_intercessions;
        rows.forEach(r => Object.assign(DB.prayer_requests[r.id], b));
        return { data: rows.map(r => ({ id: r.id })), error: null };
      }
      rows.forEach(r => Object.assign(DB[t === 'checkins' ? 'checkins' : t][r.id], q.body));
      if (t === 'checkins') rows.forEach(r => toque(r.id)); // gatilho ck_updated_at (supabase/17-consumo.sql)
      return { data: rows.map(r => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      if (t === 'group_members') { const gid = (q.filters.find(f => f[1] === 'group_id') || [])[2], uid = (q.filters.find(f => f[1] === 'user_id') || [])[2]; const m = DB.gm.find(x => x.group_id === gid && x.user_id === uid && (uid === me || DB.gm.some(l => l.group_id === gid && l.user_id === me && l.role === 'leader'))); if (m) DB.gm = DB.gm.filter(x => x !== m); return { data: m ? [{ user_id: m.user_id }] : [], error: null } } // gm_delete
      if (t === 'prayer_sessions') { const rows = applyFilters(Object.values(DB.ps).filter(r => r.user_id === me), q.filters); rows.forEach(r => { delete DB.ps[r.id]; delete DB.psh[r.id] }); return psDepois('delete', { data: q.returning ? rows.map(r => ({ id: r.id })) : null, error: null }) } // ps_delete (+ compartilhamento junto)
      if (t === 'prayer_shares') { const rows = applyFilters(Object.values(DB.psh).filter(r => r.user_id === me), q.filters); rows.forEach(r => { delete DB.psh[r.session_id] }); return { data: null, error: null } } // psh_delete
      if (t === 'prayer_requests') { // pr_delete: o autor, ou a líder da caravana (se não for pessoal)
        const lider = r => !r.is_private && DB.gm.some(m => m.group_id === r.group_id && m.user_id === me && m.role === 'leader');
        const rows = applyFilters(Object.values(DB.prayer_requests), q.filters).filter(r => r.user_id === me || lider(r));
        rows.forEach(r => { delete DB.prayer_requests[r.id]; DB.pi = DB.pi.filter(x => x.request_id !== r.id) });
        return { data: q.returning ? rows.map(r => ({ id: r.id })) : null, error: null };
      }
      if (t === 'prayer_intercessions') { DB.pi = DB.pi.filter(x => !(x.user_id === me && applyFilters([x], q.filters).length)); return { data: null, error: null } } // pi_delete
      if (t === 'likes') { q.filters.forEach(f => { if (f[1] === 'checkin_id' && DB.likes.some(l => l.user_id === me && l.checkin_id === f[2])) toque(f[2]) }); DB.likes = DB.likes.filter(l => !(l.user_id === me && q.filters.some(f => f[1] === 'checkin_id' && f[2] === l.checkin_id))); return { data: null, error: null } }
      if (t === 'checkins') { // ck_delete (a própria) + ck_delete_leader (a líder da caravana; supabase/9-lider-apaga-passo.sql)
        const lider = k => { const c = DB.challenges[k.challenge_id]; return !O.semLiderApaga && c && DB.gm.some(m => m.group_id === c.group_id && m.user_id === me && m.role === 'leader') };
        const rows = applyFilters(Object.values(DB.checkins), q.filters).filter(k => k.user_id === me || lider(k));
        rows.forEach(k => { delete DB.checkins[k.id]; DB.likes = DB.likes.filter(l => l.checkin_id !== k.id); Object.values(DB.comments).forEach(c => { if (c.checkin_id === k.id) delete DB.comments[c.id] }) });
        return { data: q.returning ? rows.map(k => ({ id: k.id })) : null, error: null };
      }
      return { data: null, error: null };
    }
    return err('operação desconhecida');
  }
  function rpc(me, name, a) {
    if (name === 'ps_corrigir') { // supabase/18-orando-na-caravana.sql: só a própria, só concluída, só o fim (depois do início, nunca no futuro, até 24 h)
      if (O.pshAntigo) return err('Could not find the function public.ps_corrigir(p_fim, p_id) in the schema cache', 'PGRST202');
      const r = DB.ps[a.p_id]; if (!r || r.user_id !== me || r.status !== 'done') return { data: [], error: null };
      const n = Object.assign({}, r, { ended_at: sec(a.p_fim) }); if (n.ended_at > agora()) n.ended_at = agora();
      const c = psCheck(n); if (c) return err('new row for relation "prayer_sessions" violates check constraint "' + c + '"', '23514');
      DB.ps[n.id] = n; if (DB.psh[n.id] && !O.pshAntigo) DB.psh[n.id].ended_at = n.ended_at;
      return { data: [psOut(n)], error: null };
    }
    if (name === 'feed_version') {
      if (O.semVersao) return err('Could not find the function public.feed_version(p_challenges, p_groups) in the schema cache', 'PGRST202');
      const cs = (a.p_challenges || []).map(String), gs = (a.p_groups || []).map(String);
      const ks = visible('checkins', me).filter(k => cs.includes(String(k.challenge_id))).sort((x, y) => x.id.localeCompare(y.id));
      const dados = JSON.stringify([ks, visible('challenges', me).filter(c => gs.includes(String(c.group_id))), DB.gm.filter(m => gs.includes(String(m.group_id)) && member(me, m.group_id)), visible('profiles', me)]);
      return { data: crypto.createHash('md5').update(dados).digest('hex'), error: null };
    }
    if (name === 'pray_version') return O.semPrayVersion ? err('Could not find the function public.pray_version without parameters in the schema cache', 'PGRST202') : { data: crypto.createHash('md5').update(JSON.stringify([visible('prayer_requests', me), visible('prayer_intercessions', me)])).digest('hex'), error: null };
    if (name === 'can_create') return O.semListaCriadores ? err('Could not find the function public.can_create without parameters in the schema cache', 'PGRST202') : { data: DB.criadores.has(me), error: null };
    if (name === 'create_group') { if (!O.semListaCriadores && !DB.criadores.has(me)) return SO_LIDER('caravanas'); const g = { id: id(), name: a.p_name, invite_code: crypto.randomBytes(3).toString('hex').toUpperCase() }; DB.groups[g.id] = g; DB.gm.push({ group_id: g.id, user_id: me, role: 'leader' }); return { data: g.id, error: null } }
    if (name === 'join_group') { const g = Object.values(DB.groups).find(x => x.invite_code === String(a.p_code).trim().toUpperCase()); if (!g) return err('Código inválido'); if (!member(me, g.id)) DB.gm.push({ group_id: g.id, user_id: me, role: 'member' }); return { data: g.id, error: null } }
    if (name === 'group_roster') {
      if (!O.rosterRpc) return err('Could not find the function public.group_roster(p_group) in the schema cache', 'PGRST202');
      if (!member(me, a.p_group)) return { data: [], error: null };
      return { data: DB.gm.filter(m => m.group_id === a.p_group).map(m => ({ user_id: m.user_id, role: m.role, name: (DB.profiles[m.user_id] || {}).name || (DB.users[m.user_id] || {}).name || 'Peregrino' })).sort((x, y) => (y.role === 'leader') - (x.role === 'leader') || x.name.localeCompare(y.name)), error: null };
    }
    if (name === 'leave_group') {
      const m = DB.gm.find(x => x.group_id === a.p_group && x.user_id === me); if (!m) return { data: null, error: null };
      if (m.role === 'leader' && DB.gm.some(x => x.group_id === a.p_group && x.user_id !== me)) return err('O líder não pode sair enquanto houver outras pessoas na caravana.');
      DB.gm = DB.gm.filter(x => x !== m); return { data: null, error: null };
    }
    return err('Could not find the function', 'PGRST202');
  }
  function storage(me, q) {
    if (q.op === 'upload') { if (!q.path.startsWith(me + '/')) return err('rls', '42501'); if (O.tipos && !O.tipos.some(t => t.endsWith('/*') ? (q.ct || '').startsWith(t.slice(0, -1)) : t === q.ct)) return { data: null, error: { message: 'mime type ' + q.ct + ' is not supported', statusCode: '415' } }; if (DB.objects[q.path]) return err('The resource already exists', '409'); DB.objects[q.path] = { size: q.size, owner: me, cache: q.cache }; return { data: { path: q.path }, error: null } }
    if (q.op === 'list') { const pre = q.prefix.replace(/\/$/, '') + '/'; return { data: Object.keys(DB.objects).filter(p => p.startsWith(pre) && !p.slice(pre.length).includes('/')).map(p => ({ name: p.slice(pre.length), metadata: { size: DB.objects[p].size || 0, mimetype: DB.objects[p].ct || '' } })), error: null } }
    if (q.op === 'remove') { const gone = q.paths.filter(p => p.startsWith(me + '/') && DB.objects[p]); gone.forEach(p => delete DB.objects[p]); return { data: gone.map(name => ({ name })), error: null } }
    if (q.op === 'sign' && O.imgBase) return { data: q.paths.map(p => ({ path: p, signedUrl: DB.objects[p] ? O.imgBase + encodeURIComponent(p) : null, error: DB.objects[p] ? null : 'not found' })), error: null }; // fotos servidas com atraso, como na internet
    if (q.op === 'sign') return { data: q.paths.map(p => ({ path: p, signedUrl: DB.objects[p] || p.startsWith('antigo/') ? 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#c96"/></svg>') + '#' + p : null, error: DB.objects[p] ? null : 'not found' })), error: null };
  }
  // dados prontos
  function usuario(nome, semPerfil) { const u = { id: id(), name: nome, email: nome.toLowerCase().replace(/\W/g, '') + '@t' }; DB.users[u.id] = u; if (!semPerfil) DB.profiles[u.id] = { id: u.id, name: nome }; return u }
  function caravana(lider, nome) { const g = { id: id(), name: nome, invite_code: crypto.randomBytes(3).toString('hex').toUpperCase() }; DB.groups[g.id] = g; DB.gm.push({ group_id: g.id, user_id: lider.id, role: 'leader' }); return g } // criada pelo SQL Editor
  function criador(u) { DB.criadores.add(u.id) }
  function entrar(u, g) { return rpc(u.id, 'join_group', { p_code: g.invite_code }) }
  function jornada(g, nome, ini = -3, fim = 12) { const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) }; const c = { id: id(), group_id: g.id, name: nome, description: '', start_date: d(ini), end_date: d(fim), goal_per_week: 7 }; DB.challenges[c.id] = c; return c }
  function publicacao(u, c, extra = {}) { const k = Object.assign({ id: id(), user_id: u.id, challenge_id: c.id, read_date: today(), book: 'Romanos', ref: '1', chapters: 1, study_minutes: 10, photo_path: 'antigo/' + id() + '.jpg', media_type: 'image', created_at: new Date().toISOString() }, extra); if (!k.updated_at) k.updated_at = k.created_at; DB.checkins[k.id] = k; return k }
  function pedido(u, g, extra = {}) { const r = Object.assign({ id: id(), group_id: g.id, user_id: u.id, title: null, body: 'Pedido de ' + u.name, is_private: false, answered_at: null, testimony: null, created_at: new Date().toISOString() }, extra); DB.prayer_requests[r.id] = r; return r }
  return { O, DB, log, handle, usuario, caravana, criador, entrar, jornada, publicacao, pedido, member };
}

// Código que roda DENTRO do navegador: imita a biblioteca supabase-js e manda tudo para o servidor falso.
const cliente = `(function(){
  var me=null;try{me=localStorage.getItem('fake_me')}catch(e){}
  function call(q){return window.__api(me,JSON.stringify(q)).then(function(r){return JSON.parse(r)})}
  function Q(table){this.q={table:table,op:'select',filters:[],order:[]}}
  Q.prototype.select=function(c){if(this.q.op!=='select')this.q.returning=true;else this.q.cols=c;return this};
  ['eq','in','is','like','gte','gt'].forEach(function(k){Q.prototype[k]=function(c,v){this.q.filters.push([k,c,v]);return this}});
  Q.prototype.order=function(c,o){this.q.order.push({col:c,asc:!o||o.ascending!==false});return this};
  Q.prototype.range=function(a,b){this.q.range=[a,b];return this};
  Q.prototype.limit=function(n){this.q.limit=n;return this};
  Q.prototype.single=function(){this.q.single=true;return this};
  Q.prototype.insert=function(b){this.q.op='insert';this.q.body=b;return this};
  Q.prototype.update=function(b){this.q.op='update';this.q.body=b;return this};
  Q.prototype.delete=function(){this.q.op='delete';return this};
  Q.prototype.then=function(a,b){return call(this.q).then(a,b)};
  window.supabase={createClient:function(){return{
    from:function(t){return new Q(t)},
    rpc:function(n,a){return call({rpc:n,args:a})},
    auth:{getSession:function(){return Promise.resolve({data:{session:me?{user:{id:me,user_metadata:JSON.parse(localStorage.getItem('fake_md')||'{}')}}:null}})},
      getUser:function(){return Promise.resolve({data:{user:{id:me,phone_confirmed_at:1}}})},
      updateUser:function(d){if(d&&d.data)localStorage.setItem('fake_md',JSON.stringify(d.data));return Promise.resolve({data:{},error:null})},
      onAuthStateChange:function(){},signOut:function(){return Promise.resolve({})}},
    storage:{from:function(){return{
      upload:function(p,b,o){return call({storage:1,op:'upload',path:p,size:b.size,ct:(o&&o.contentType)||b.type,cache:o&&o.cacheControl})},
      remove:function(ps){return call({storage:1,op:'remove',paths:ps})},
      list:function(pr){return call({storage:1,op:'list',prefix:pr||''})},
      createSignedUrls:function(ps){return call({storage:1,op:'sign',paths:ps})}}}}
  }}};
})();`;
module.exports = { novoServidor, cliente };
