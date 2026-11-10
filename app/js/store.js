// État local : réglages de l'appareil et abonnements (synchronisés via les serveurs).
import * as api from './api.js';
import * as profiles from './profiles.js';
import { pool, debounce } from './ui.js';

export const events = new EventTarget();
const emit = (name) => events.dispatchEvent(new Event(name));

// ───────────── Réglages ─────────────

const SETTINGS_KEY = 'scrollarr.settings';
const defaults = {
  theme: 'auto',        // auto | light | dark
  lang: 'auto',         // auto | fr | en
  gap: 0,               // espace entre les pages, en px
  maxWidth: 760,        // largeur maximale de la bande de lecture, en px
  readerBg: 'black',    // black | white
  autoSpeed: 90,        // défilement automatique, en px/s
  keepAwake: true,
};
let settings;
export function getSettings() {
  if (!settings) {
    try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
    catch { settings = { ...defaults }; }
  }
  return settings;
}
export function setSetting(key, value) {
  getSettings()[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (key === 'theme') applyTheme();
  emit('settings');
}
export function applyTheme() {
  const th = getSettings().theme;
  if (th === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
}

// ───────────── Abonnements ─────────────
// Komga n'a pas de notion de favori par utilisateur : la liste est conservée
// sur l'appareil et recopiée dans les « client settings » du compte Komga pour
// suivre l'utilisateur d'un appareil à l'autre.

let favs; // { updatedAt, items: { [seriesId]: { id, title, seen, added } } }

function loadFavs() {
  if (!favs) {
    try { favs = JSON.parse(localStorage.getItem(profiles.favKey())); } catch { /* ignoré */ }
    if (!favs || typeof favs.items !== 'object') favs = { updatedAt: 0, items: {} };
  }
  return favs;
}
const pushRemote = debounce(() => {
  api.setClientSetting(profiles.favKey(), JSON.stringify(loadFavs())).catch(() => { /* réessayé au prochain changement */ });
}, 800);
function saveFavs({ remote = true } = {}) {
  favs.updatedAt = Date.now();
  localStorage.setItem(profiles.favKey(), JSON.stringify(favs));
  if (remote) pushRemote();
  emit('favorites');
}

/** Récupère la liste du serveur ; la version la plus récente l'emporte. */
export async function syncFavorites() {
  const local = loadFavs();
  let remote;
  try { remote = JSON.parse(await api.getClientSetting(profiles.favKey())); } catch { return; }
  if (remote && typeof remote.items === 'object' && (remote.updatedAt || 0) > (local.updatedAt || 0)) {
    favs = remote;
    localStorage.setItem(profiles.favKey(), JSON.stringify(favs));
    emit('favorites');
  } else if ((local.updatedAt || 0) > (remote?.updatedAt || 0)) {
    pushRemote();
  }
}

export const favorites = () => Object.values(loadFavs().items).sort((a, b) => b.added - a.added);
export const favoriteIds = () => Object.keys(loadFavs().items);
export const isFavorite = (id) => id in loadFavs().items;

export function toggleFavorite(series) {
  const f = loadFavs();
  if (f.items[series.id]) delete f.items[series.id];
  else f.items[series.id] = { id: series.id, title: series.metadata?.title || series.name, seen: series.booksCount, added: Date.now() };
  saveFavs();
  return isFavorite(series.id);
}

/** À appeler quand l'utilisateur ouvre la fiche : remet le compteur de nouveautés à zéro. */
export function markSeen(series) {
  const item = loadFavs().items[series.id];
  if (!item) return;
  const title = series.metadata?.title || series.name;
  if (item.seen === series.booksCount && item.title === title) return;
  item.seen = series.booksCount;
  item.title = title;
  delete newCounts[series.id];
  saveFavs();
}

// Nombre de chapitres arrivés depuis la dernière visite, par série.
let newCounts = {};
export const newCount = (id) => newCounts[id] || 0;
export const hasNews = () => Object.values(newCounts).some((n) => n > 0);

/** Interroge le serveur de chaque abonnement et renvoie les fiches à jour. */
export async function refreshFavorites() {
  const items = favorites();
  const fresh = await pool(items, 4, async (item) => {
    // Serveur désactivé ou déconnecté : l'abonnement est conservé, simplement pas rafraîchi.
    if (!api.reachable(item.id)) return null;
    try { return await api.series(item.id); }
    catch (e) { return e instanceof api.ApiError && e.status === 404 ? 'gone' : null; }
  });
  const f = loadFavs();
  let changed = false;
  newCounts = {};
  const out = [];
  items.forEach((item, i) => {
    const s = fresh[i];
    if (s === 'gone') { delete f.items[item.id]; changed = true; return; }
    if (s) newCounts[item.id] = Math.max(0, s.booksCount - (item.seen ?? s.booksCount));
    out.push({ item, series: s });
  });
  if (changed) saveFavs(); else emit('favorites');
  return out;
}
