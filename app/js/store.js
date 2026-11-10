// État local : réglages de l'appareil et abonnements (synchronisés via les serveurs).
import * as api from './api.js';
import * as profiles from './profiles.js';
import { mergeFavs, deviceId } from './sync.js';
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
// La liste est conservée sur l'appareil et recopiée sur les serveurs pour
// suivre l'utilisateur d'un appareil à l'autre. Chaque abonnement porte une
// révision (voir sync.js) : deux appareils fusionnent leurs listes entrée par
// entrée, et un désabonnement laisse une marque au lieu de disparaître.

let favs; // { updatedAt, items: { [seriesId]: { id, title, seen, added, rev, dev, del? } } }
let favGen = 0; // augmente à chaque modification locale

function loadFavs() {
  if (!favs) {
    try { favs = JSON.parse(localStorage.getItem(profiles.favKey())); } catch { /* ignoré */ }
    if (!favs || typeof favs.items !== 'object') favs = { updatedAt: 0, items: {} };
  }
  return favs;
}
const persist = () => localStorage.setItem(profiles.favKey(), JSON.stringify(favs));
const stamp = (prev) => ({ rev: (prev?.rev || 0) + 1, dev: deviceId() });

/** Lit la liste du serveur, la fusionne avec celle de l'appareil, puis renvoie le résultat. */
async function exchange({ write }) {
  const key = profiles.favKey();
  let text;
  try { text = await api.getClientSetting(key); }
  catch { return; } // serveur injoignable : on réessaiera, sans rien écraser
  let remote = null;
  try { remote = JSON.parse(text); } catch { /* rien d'enregistré sur le serveur */ }
  const gen = favGen;
  const before = JSON.stringify(loadFavs().items);
  favs = mergeFavs(loadFavs(), remote);
  persist();
  if (JSON.stringify(favs.items) !== before) emit('favorites');
  if (write || JSON.stringify(favs.items) !== JSON.stringify(remote?.items || {})) {
    try { await api.setClientSetting(key, JSON.stringify(favs)); } catch { return; }
  }
  // Une modification faite pendant l'échange part à son tour.
  if (favGen !== gen) pushRemote();
}
const pushRemote = debounce(() => exchange({ write: true }), 800);

function saveFavs() {
  favGen++;
  favs.updatedAt = Date.now();
  persist();
  pushRemote();
  emit('favorites');
}

/** À l'ouverture : récupère ce que les autres appareils ont changé. */
export const syncFavorites = () => exchange({ write: false });

const isOn = (item) => !!item && !item.del;
export const favorites = () => Object.values(loadFavs().items).filter(isOn).sort((a, b) => b.added - a.added);
export const favoriteIds = () => favorites().map((f) => f.id);
export const isFavorite = (id) => isOn(loadFavs().items[id]);

export function toggleFavorite(series) {
  const f = loadFavs();
  const prev = f.items[series.id];
  f.items[series.id] = isOn(prev)
    ? { id: series.id, title: prev.title, del: 1, ...stamp(prev) }
    : { id: series.id, title: series.metadata?.title || series.name, seen: series.booksCount, added: Date.now(), ...stamp(prev) };
  saveFavs();
  return isFavorite(series.id);
}

/** À appeler quand l'utilisateur ouvre la fiche : remet le compteur de nouveautés à zéro. */
export function markSeen(series) {
  const item = loadFavs().items[series.id];
  if (!isOn(item)) return;
  const title = series.metadata?.title || series.name;
  if (item.seen === series.booksCount && item.title === title) return;
  favs.items[series.id] = { ...item, seen: series.booksCount, title, ...stamp(item) };
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
    if (s === 'gone') { f.items[item.id] = { id: item.id, title: item.title, del: 1, ...stamp(item) }; changed = true; return; }
    if (s) newCounts[item.id] = Math.max(0, s.booksCount - (item.seen ?? s.booksCount));
    out.push({ item, series: s });
  });
  if (changed) saveFavs(); else emit('favorites');
  return out;
}
