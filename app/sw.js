// Service worker de Scrollarr.
//  - coquille de l'application : servie depuis le cache, rafraîchie en arrière-plan ;
//  - pages téléchargées : servies depuis le cache « téléchargements » ;
//  - vignettes : cache d'abord, rafraîchies en arrière-plan ;
//  - notifications push.
const SHELL = 'scrollarr-shell-v13';
const THUMBS = 'scrollarr-thumbs-v1';
const DL = 'scrollarr-dl-v1'; // doit correspondre à DL_CACHE dans js/config.js
const THUMBS_MAX = 700;

const SCOPE = new URL(self.registration.scope).pathname;
// Préfixes des proxys vers les serveurs (un par connecteur) et vers le notifier.
const SERVERS = ['komga/', 'suwayomi/', 'folders/'].map((p) => SCOPE + p);
const NOTIFY = SCOPE + 'notify/';

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/BigShouldersDisplay.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/api.js', 'js/components.js', 'js/config.js', 'js/downloads.js', 'js/i18n.js', 'js/idb.js',
  'js/net.js', 'js/profiles.js', 'js/push.js', 'js/router.js', 'js/store.js', 'js/sync.js', 'js/tasks.js', 'js/ui.js',
  'js/connectors/contract.js', 'js/connectors/reader-contract.js', 'js/connectors/collector-contract.js', 'js/connectors/index.js',
  'js/connectors/suwayomi-client.js', 'js/connectors/suwayomi-queries.js',
  'js/connectors/readers/folders.js', 'js/connectors/readers/komga.js', 'js/connectors/readers/suwayomi.js', 'js/connectors/collectors/suwayomi.js',
  'js/views/collect.js', 'js/views/home.js', 'js/views/library.js', 'js/views/login.js', 'js/views/more.js', 'js/views/my.js', 'js/views/profiles.js',
  'js/views/reader.js', 'js/views/search.js', 'js/views/series.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, THUMBS, DL]);
    for (const k of await caches.keys()) if (k.startsWith('scrollarr-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Komga : /api/v1/books/<id>/pages/<n> — Suwayomi : /api/v1/manga/<id>/chapter/<n>/page/<n>
const isPage = (path) => /\/api\/v1\/(books\/[^/]+\/pages|manga\/\d+\/chapter\/\d+\/page)\/\d+$/.test(path);
const isThumb = (path) => /\/api\/v1\/(books|series|manga)\/[^/]+\/thumbnail$/.test(path);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (SERVERS.some((p) => url.pathname.startsWith(p))) {
    if (isPage(url.pathname)) event.respondWith(page(req));
    else if (isThumb(url.pathname)) event.respondWith(thumb(event, req));
    return; // le reste de l'API passe directement au réseau
  }
  if (url.pathname.startsWith(NOTIFY) || url.pathname === SCOPE + 'servers.json') return;
  if (!url.pathname.startsWith(SCOPE)) return;
  event.respondWith(shell(event, req));
});

/** Page de chapitre : la copie téléchargée si elle existe, sinon le réseau. */
async function page(req) {
  const hit = await caches.match(req.url, { cacheName: DL, ignoreSearch: true });
  return hit || fetch(req);
}

/** Vignette : réponse immédiate depuis le cache, mise à jour en arrière-plan. */
async function thumb(event, req) {
  const pinned = await caches.match(req.url, { cacheName: DL });
  const cache = await caches.open(THUMBS);
  const hit = pinned || (await cache.match(req.url));
  const refresh = fetch(req).then(async (res) => {
    if (res.ok) { await cache.put(req.url, res.clone()); trim(cache); }
    return res;
  });
  if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh;
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - THUMBS_MAX))) await cache.delete(k);
  } finally { trimming = false; }
}

/** Coquille : cache d'abord, puis mise à jour silencieuse pour le prochain lancement. */
async function shell(event, req) {
  const cache = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  const refresh = fetch(req.mode === 'navigate' ? 'index.html' : req, { cache: 'no-cache' }).then(async (res) => {
    if (res.ok) {
      if (hit && req.mode !== 'navigate' && /\.(js|css)$/.test(new URL(req.url).pathname)) {
        const [a, b] = await Promise.all([hit.clone().text(), res.clone().text()]);
        if (a !== b) announceUpdate();
      }
      await cache.put(key, res.clone());
    }
    return res;
  });
  if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh.catch(() => new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
}

let announced = false;
async function announceUpdate() {
  if (announced) return;
  announced = true;
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated' });
}

// ── Notifications push ──
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* charge utile illisible */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Scrollarr', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: data.tag,
    data: { path: typeof data.path === 'string' ? data.path : '/home' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/home';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).pathname.startsWith(SCOPE));
    if (win) { await win.focus(); win.postMessage({ type: 'navigate', path }); }
    else await self.clients.openWindow(SCOPE + '#' + path);
  })());
});
