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
  const DB = { users: {}, profiles: {}, groups: {}, gm: [], challenges: {}, checkins: {}, likes: [], comments: {}, messages: {}, objects: {}, criadores: new Set() }; // criadores: lista de quem pode criar (supabase/6-so-a-lider-cria.sql)
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
        b.id = id(); b.created_at = new Date(Date.now() + Object.keys(DB.checkins).length).toISOString();
        DB.checkins[b.id] = b;
        if (O.falhas['checkins:insert:depois'] > 0) { O.falhas['checkins:insert:depois']--; return new Promise(() => {}) } // gravou, mas a resposta se perdeu
        return { data: q.returning ? (q.single ? b : [b]) : null, error: null };
      }
      if (t === 'challenges') { if (!O.semListaCriadores && !DB.criadores.has(me)) return SO_LIDER('jornadas'); if (!DB.gm.some(m => m.user_id === me && m.group_id === b.group_id && m.role === 'leader')) return err('rls', '42501'); b.id = id(); DB.challenges[b.id] = b; return { data: q.single ? b : [b], error: null } }
      if (t === 'messages') { b.id = id(); b.user_id = me; b.created_at = new Date().toISOString(); DB.messages[b.id] = b; return { data: null, error: null } }
      if (t === 'comments') { b.id = id(); b.user_id = me; b.created_at = new Date().toISOString(); DB.comments[b.id] = b; return { data: null, error: null } }
      if (t === 'likes') { DB.likes.push({ checkin_id: b.checkin_id, user_id: me }); return { data: null, error: null } }
      return err('tabela desconhecida');
    }
    if (q.op === 'update') {
      let rows = applyFilters(visible(t, me), q.filters);
      if (t === 'checkins') rows = rows.filter(r => r.user_id === me);
      if (t === 'profiles') {
        if (O.semAvatar && 'avatar_path' in q.body) return err("Could not find the 'avatar_path' column of 'profiles' in the schema cache", 'PGRST204');
        rows = rows.filter(r => r.id === me);
        const a = q.body.avatar_path; if (a != null && !new RegExp('^' + me + '/avatar-[0-9a-f]{8,40}\\.jpg$').test(a)) return err('new row for relation "profiles" violates check constraint "profiles_avatar_path_check"', '23514');
      }
      rows.forEach(r => Object.assign(DB[t === 'checkins' ? 'checkins' : t][r.id], q.body));
      return { data: rows.map(r => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      if (t === 'group_members') { const gid = (q.filters.find(f => f[1] === 'group_id') || [])[2], uid = (q.filters.find(f => f[1] === 'user_id') || [])[2]; const m = DB.gm.find(x => x.group_id === gid && x.user_id === uid && (uid === me || DB.gm.some(l => l.group_id === gid && l.user_id === me && l.role === 'leader'))); if (m) DB.gm = DB.gm.filter(x => x !== m); return { data: m ? [{ user_id: m.user_id }] : [], error: null } } // gm_delete
      if (t === 'likes') { DB.likes = DB.likes.filter(l => !(l.user_id === me && q.filters.some(f => f[1] === 'checkin_id' && f[2] === l.checkin_id))); return { data: null, error: null } }
      return { data: null, error: null };
    }
    return err('operação desconhecida');
  }
  function rpc(me, name, a) {
    if (name === 'feed_version') {
      if (O.semVersao) return err('Could not find the function public.feed_version(p_challenges, p_groups) in the schema cache', 'PGRST202');
      const cs = (a.p_challenges || []).map(String), gs = (a.p_groups || []).map(String);
      const ks = visible('checkins', me).filter(k => cs.includes(String(k.challenge_id))).sort((x, y) => x.id.localeCompare(y.id));
      const dados = JSON.stringify([ks, visible('challenges', me).filter(c => gs.includes(String(c.group_id))), DB.gm.filter(m => gs.includes(String(m.group_id)) && member(me, m.group_id)), visible('profiles', me)]);
      return { data: crypto.createHash('md5').update(dados).digest('hex'), error: null };
    }
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
  function publicacao(u, c, extra = {}) { const k = Object.assign({ id: id(), user_id: u.id, challenge_id: c.id, read_date: today(), book: 'Romanos', ref: '1', chapters: 1, study_minutes: 10, photo_path: 'antigo/' + id() + '.jpg', media_type: 'image', created_at: new Date().toISOString() }, extra); DB.checkins[k.id] = k; return k }
  return { O, DB, log, handle, usuario, caravana, criador, entrar, jornada, publicacao, member };
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
      createSignedUrls:function(ps){return call({storage:1,op:'sign',paths:ps})}}}}
  }}};
})();`;
module.exports = { novoServidor, cliente };
