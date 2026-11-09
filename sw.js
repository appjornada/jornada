// Jornada na Palavra: guarda no aparelho as fotos que já foram vistas (miniaturas, fotos e fotos de perfil).
//
// Por que: o link de cada foto é assinado e muda de tempos em tempos, e o celular (principalmente o iPhone,
// no app da tela inicial) apaga o cache dele com frequência. Assim a mesma miniatura era baixada de novo
// quase todo dia por cada pessoa (1.200 downloads por dia), gastando a cota do Supabase.
// Aqui a chave é o caminho do arquivo, sem a assinatura: cada foto é baixada uma vez só por aparelho.
// Os arquivos nunca mudam de conteúdo (o nome é o "hash" do arquivo), então a cópia guardada vale para sempre.
//
// Só mexe em imagens do armazenamento de fotos. Vídeos, áudios, o próprio app e o banco passam direto.
const CACHE = 'fotos-v1', MAX = 800;
const FOTO = /\/storage\/v1\/object\/sign\/photos\/.+\.(jpe?g|png|webp|gif)$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('fotos-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  let u; try { u = new URL(r.url) } catch (x) { return }
  if (!FOTO.test(u.pathname)) return;
  e.respondWith(foto(r, u.origin + u.pathname));
});

async function foto(r, chave) {
  let c = null;
  try { c = await caches.open(CACHE); const tem = await c.match(chave); if (tem) return tem } catch (x) {}
  let res;
  // pede com CORS para a resposta poder ser guardada sem ocupar espaço "inflado"; se o servidor não aceitar, vai como antes
  try { res = await fetch(r.url, { mode: 'cors', credentials: 'omit' }) } catch (x) { return fetch(r) }
  if (res.ok && c) { try { await c.put(chave, res.clone()); limpar(c) } catch (x) {} }
  return res;
}

// guarda no máximo MAX fotos; as mais antigas saem primeiro
let limpando = false;
async function limpar(c) {
  if (limpando) return; limpando = true;
  try { const ks = await c.keys(); for (let i = 0; i < ks.length - MAX; i++) await c.delete(ks[i]) } catch (x) {}
  limpando = false;
}
