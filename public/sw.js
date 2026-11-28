// Service worker: deixa o app abrir sem internet (palco, igreja, ensaio).
// Estratégia: rede primeiro (sempre pega a versão nova), com cópia local de reserva.

const CACHE = 'cifras-v3.3';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/settings.js', 'js/legacy.js',
  'js/ui/dom.js', 'js/ui/render.js', 'js/ui/fit.js', 'js/ui/player.js',
  'js/music/notes.js', 'js/music/chords.js', 'js/music/keys.js', 'js/music/parser.js', 'js/music/chart.js', 'js/music/transition.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isNav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await withTimeout(fetch(req), 4000);
      if (res && res.ok) cache.put(isNav ? 'index.html' : req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(isNav ? 'index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      return new Response('Sem conexão e sem cópia local deste arquivo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
