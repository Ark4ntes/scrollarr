// Point d'entrée : routage, barre d'onglets, session, service worker.
import * as api from './api.js';
import * as store from './store.js';
import * as downloads from './downloads.js';
import * as push from './push.js';
import * as profiles from './profiles.js';
import { h, icon, spinner, toast, emptyState } from './ui.js';
import { t, lang } from './i18n.js';
import { go, consumeForward, currentPath } from './router.js';
import { home } from './views/home.js';
import { library } from './views/library.js';
import { search } from './views/search.js';
import { series } from './views/series.js';
import { reader } from './views/reader.js';
import { my } from './views/my.js';
import { more } from './views/more.js';
import { login } from './views/login.js';
import { profilesView } from './views/profiles.js';

const routes = [
  { re: /^\/home$/, view: home, tab: 'home' },
  { re: /^\/library$/, view: library, tab: 'library' },
  { re: /^\/my(?:\/(recent|subscriptions|downloads))?$/, view: my, tab: 'my', params: ['tab'] },
  { re: /^\/more$/, view: more, tab: 'more' },
  { re: /^\/search$/, view: search },
  { re: /^\/series\/([^/]+)$/, view: series, params: ['id'] },
  { re: /^\/read\/([^/]+)$/, view: reader, params: ['id'], reading: true },
  { re: /^\/login$/, view: login, open: true },
  { re: /^\/profiles$/, view: profilesView, picker: true },
];

const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const banner = document.getElementById('offline-banner');
const scrolls = new Map();
let ready = false;
const booted = api.init();
let seq = 0;
let current = { path: null, cleanup: null };

document.documentElement.lang = lang();
store.applyTheme();

// ── Barre d'onglets ──
const tabs = [
  ['home', '/home', 'home', t('Accueil')],
  ['library', '/library', 'library', t('Bibliothèque')],
  ['my', '/my', 'my', t('Ma liste')],
  ['more', '/more', 'settings', t('Réglages')],
];
tabbar.setAttribute('aria-label', t('Navigation principale'));
tabbar.append(...tabs.map(([id, path, ico, label]) =>
  h('a.tab', { href: '#' + path, dataset: { tab: id } }, icon(ico, 24), h('span', label), id === 'my' ? h('i.dot', { hidden: true }) : null)));
const paintDot = () => { tabbar.querySelector('.dot').hidden = !store.hasNews(); };
store.events.addEventListener('favorites', paintDot);

// ── Hors ligne ──
function paintBanner() {
  const off = !navigator.onLine || !api.isReachable();
  banner.hidden = !off;
  if (off) banner.replaceChildren(icon('offline', 16), h('span', t('Serveur injoignable : seuls les chapitres téléchargés sont lisibles.')));
  document.body.classList.toggle('is-offline', off);
}
api.events.addEventListener('reachable', (e) => { paintBanner(); if (e.detail) api.flushProgress(); });
const reconnect = () => { api.retryNow(); return api.connect().then(() => api.flushProgress()).catch(() => {}); };
addEventListener('online', () => { paintBanner(); reconnect(); });
// Serveur injoignable alors que l'appareil a du réseau (hors de chez soi, NAS arrêté) :
// on revérifie au retour sur l'application, puis de temps en temps.
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine && !api.isReachable()) reconnect(); });
setInterval(() => { if (!document.hidden && navigator.onLine && !api.isReachable()) reconnect(); }, 30000);
addEventListener('offline', paintBanner);

api.events.addEventListener('unauthorized', () => {
  ready = false;
  if (!currentPath().startsWith('/login')) go('/login', { replace: true });
});

// ── Après connexion ──
function started() {
  downloads.load();
  api.flushProgress();
  store.syncFavorites().then(() => store.refreshFavorites()).then(paintDot).catch(() => {});
  push.watchFavorites();
}

// ── Rendu d'une route ──
async function render({ keepScroll = false } = {}) {
  const path = currentPath();
  const route = routes.find((r) => r.re.test(path));
  if (!route) return go('/home', { replace: true });
  const m = path.match(route.re);
  const params = Object.fromEntries((route.params || []).map((k, i) => [k, m[i + 1] && decodeURIComponent(m[i + 1])]));
  const restore = !consumeForward() || keepScroll;

  if (current.path) scrolls.set(current.path, scrollY);
  try { current.cleanup?.(); } catch (e) { console.error(e); }
  current = { path, cleanup: null };
  const id = ++seq;

  const page = h('div.page');
  const waiting = setTimeout(() => { if (id === seq && !page.childElementCount) page.append(spinner()); }, 150);
  document.body.classList.toggle('reading', !!route.reading);
  tabbar.hidden = !route.tab;
  tabbar.querySelectorAll('.tab').forEach((a) => (a.dataset.tab === route.tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  viewEl.replaceChildren(page);
  if (!keepScroll) scrollTo(0, 0);

  try {
    await booted;
    if (!route.open && !ready) {
      await api.connect();
      if (id !== seq) return;
      if (api.needsLogin()) return go('/login', { replace: true });
      await profiles.load();
      if (id !== seq) return;
      ready = true;
      started();
    }
    // Plusieurs profils et aucun choisi sur cet appareil : on demande qui lit.
    if (!route.open && !route.picker && profiles.needsChoice()) return go('/profiles', { replace: true });
    if (id !== seq) return;
    const cleanup = await route.view(page, params, { onDone: () => { ready = false; go('/home', { replace: true }); } });
    page.querySelector(':scope > .spinner')?.remove();
    if (id !== seq) { cleanup?.(); return; }
    current.cleanup = cleanup || null;
    if (restore && !route.reading && scrolls.has(path)) scrollTo(0, scrolls.get(path));
  } catch (e) {
    if (id !== seq) return;
    if (e instanceof api.AuthError) { ready = false; return go('/login', { replace: true }); }
    console.error(e);
    const offline = e instanceof api.OfflineError;
    const notFound = e instanceof api.ApiError && e.status === 404;
    page.replaceChildren(emptyState(
      offline ? t('Serveur injoignable') : notFound ? t('Introuvable') : t('Quelque chose a échoué'),
      offline ? t('Cet écran n’a pas encore été consulté en ligne. Vos chapitres téléchargés restent lisibles.')
        : notFound ? t('Cette série ou ce chapitre n’existe plus sur le serveur.')
          : t('Rechargez la page. Si le problème revient, consultez les journaux de Komga.'),
      h('div.empty-actions',
        h('button.btn.primary', { type: 'button', onclick: () => render() }, t('Réessayer')),
        offline ? h('a.btn', { href: '#/my/downloads' }, t('Voir les téléchargements')) : h('a.btn', { href: '#/home' }, t('Aller à l’accueil')))));
    if (route.reading) document.body.classList.remove('reading');
    tabbar.hidden = false;
  } finally {
    clearTimeout(waiting);
  }
}

addEventListener('hashchange', () => render());
addEventListener('app:refresh', () => render({ keepScroll: true }));
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
paintBanner();
render();

// ── Service worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non installé', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && typeof e.data.path === 'string') go(e.data.path);
    if (e.data?.type === 'updated') {
      toast(t('Nouvelle version de Scrollarr installée.'), { action: t('Recharger'), onAction: () => location.reload(), duration: 0 });
    }
  });
}
