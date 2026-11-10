// Profils : plusieurs personnes partagent la même installation sans partager
// leur historique. Ce ne sont pas des comptes — aucun mot de passe, n'importe
// qui peut ouvrir n'importe quel profil.
//
//  - Le profil principal (« main ») utilise l'historique du serveur lui-même,
//    comme avant : il reste commun avec l'interface de Suwayomi ou de Komga.
//  - Chaque autre profil tient sa propre progression et ses abonnements dans
//    de petits documents rangés sur le serveur (voir loadDocs/saveDoc dans
//    api.js), ce qui les rend disponibles sur tous les appareils.
import * as api from './api.js';

const LIST_KEY = 'scrollarr.profiles';
const ACTIVE_KEY = 'scrollarr.profile';
const LIST_MIRROR = 'scrollarr.profiles.cache';
const MAIN = 'main';
const RECENT_MAX = 40;

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

let profiles = readJson(LIST_MIRROR, null) || [{ id: MAIN, name: 'Principal' }];
let activeId = localStorage.getItem(ACTIVE_KEY) || MAIN;

export const list = () => profiles;
export const active = () => profiles.find((p) => p.id === activeId) || profiles[0];
export const isExtra = () => active().id !== MAIN;
/** Plusieurs profils existent et cet appareil n'a pas encore dit lequel est le sien. */
export const needsChoice = () => profiles.length > 1 && !profiles.some((p) => p.id === localStorage.getItem(ACTIVE_KEY));
/** Clé sous laquelle les abonnements du profil actif sont rangés (sur l'appareil comme sur le serveur). */
export const favKey = () => (activeId === MAIN ? 'scrollarr.favorites' : `scrollarr.p.${activeId}.fav`);

const prefix = (id = activeId) => `scrollarr.p.${id}.`;
const mirrorKey = (id = activeId) => `scrollarr.pmirror.${id}`;

// ───────────── Liste des profils ─────────────

async function saveList() {
  localStorage.setItem(LIST_MIRROR, JSON.stringify(profiles));
  await api.setClientSetting(LIST_KEY, JSON.stringify(profiles));
}

export async function create(name) {
  const p = { id: 'p' + Math.random().toString(36).slice(2, 8), name: name.trim().slice(0, 30) };
  profiles = [...profiles, p];
  // L'appareil qui crée un second profil garde le sien : pas besoin de lui redemander « Qui lit ? ».
  if (!localStorage.getItem(ACTIVE_KEY)) localStorage.setItem(ACTIVE_KEY, activeId);
  await saveList();
  return p;
}
export async function rename(id, name) {
  profiles = profiles.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 30) } : p));
  await saveList();
}
/** Supprime un profil secondaire et tout son historique. */
export async function remove(id) {
  if (id === MAIN) return;
  profiles = profiles.filter((p) => p.id !== id);
  await saveList();
  await api.deleteDocs(prefix(id)).catch(() => {});
  localStorage.removeItem(mirrorKey(id));
  localStorage.removeItem(`scrollarr.p.${id}.fav`);
  if (id === activeId) choose(MAIN);
}
/** Change de profil sur cet appareil. Tout l'état en mémoire dépend du profil : on recharge. */
export function choose(id) {
  localStorage.setItem(ACTIVE_KEY, id);
  location.hash = '#/home';
  location.reload();
}

// ───────────── Historique d'un profil secondaire ─────────────
// Par serveur : un index (compteurs par série + derniers chapitres ouverts) et
// un document par série (page atteinte dans chaque chapitre).
//   idx      { s: { cléSérie: [lus, enCours, date] }, r: [ { b, s, st, nm, n, p, tot, c, t } ] }
//   s.<clé>  { idChapitre: [page, terminé (0/1), date, effacé (1) ?] }
//
// Deux appareils peuvent lire sous le même profil. Chaque entrée porte donc sa
// date, et tout échange avec le serveur est une fusion entrée par entrée (la
// plus récente gagne) plutôt qu'un remplacement du document. Une entrée
// effacée laisse une marque datée, sinon l'autre appareil la ferait revenir.

let docs = {};            // { idServeur: { idx, series: { cléSérie: {…} } } }
const dirty = new Set();  // « idServeur|idx » ou « idServeur|s.<clé> » à renvoyer au serveur
const byBook = new Map(); // idChapitre préfixé → [page, terminé, date, effacé ?]
let timer = 0;

const raw = (id) => String(id).slice(String(id).indexOf(':') + 1);
// Komga n'accepte que des clés en minuscules, segments alphanumériques.
const seriesKey = (seriesId) => raw(seriesId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const emptyServer = () => ({ idx: { s: {}, r: [] }, series: {} });
const server = (id) => (docs[api.serverOf(id)] ||= emptyServer());
const live = (v) => !!v && !v[3];
const now = () => Math.floor(Date.now() / 1000);

/** Fusion de deux documents de série : pour chaque chapitre, l'entrée la plus récente. */
export function mergeSeries(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || v[2] > out[k][2]) out[k] = v;
  return out;
}
/** Fusion de deux index : compteurs les plus récents par série, historique réuni et borné. */
export function mergeIdx(a = {}, b = {}) {
  const s = { ...(a.s || {}) };
  for (const [k, v] of Object.entries(b.s || {})) if (!s[k] || v[2] > s[k][2]) s[k] = v;
  const byId = new Map();
  for (const e of [...(a.r || []), ...(b.r || [])]) if (!byId.has(e.b) || e.t > byId.get(e.b).t) byId.set(e.b, e);
  return { s, r: [...byId.values()].sort((x, y) => y.t - x.t).slice(0, RECENT_MAX) };
}

function mirror() {
  try { localStorage.setItem(mirrorKey(), JSON.stringify({ docs, dirty: [...dirty] })); } catch { /* stockage plein : la copie locale est facultative */ }
}
function index() {
  byBook.clear();
  for (const [sid, d] of Object.entries(docs)) {
    const code = api.codeOf(sid);
    if (!code) continue;
    for (const ser of Object.values(d.series)) for (const [bookRaw, v] of Object.entries(ser)) byBook.set(`${code}:${bookRaw}`, v);
  }
}
/** Recalcule le compteur d'une série à partir de son document, qui fait foi. */
function recount(d, key) {
  const all = Object.values(d.series[key] || {});
  const entries = all.filter(live);
  const t = Math.max(0, ...all.map((e) => e[2]));
  d.idx.s[key] = [entries.filter((e) => e[1]).length, entries.some((e) => !e[1]) ? 1 : 0, t];
}
/** Retire de l'historique les chapitres effacés depuis. */
function prune(d) {
  d.idx.r = d.idx.r.filter((e) => { const v = byBook.get(e.b); return !v || live(v) || v[2] < e.t; });
}
function touch(sid, key) {
  dirty.add(`${sid}|idx`);
  dirty.add(`${sid}|s.${key}`);
}
function schedule(immediately) {
  mirror();
  clearTimeout(timer);
  if (immediately) flush().catch(() => {});
  else timer = setTimeout(() => flush().catch(() => {}), 5000);
}

/** Intègre la version du serveur d'un document dans la mémoire, sans rien perdre de local. */
function absorb(sid, name, text) {
  let value;
  try { value = JSON.parse(text); } catch { return; }
  const d = (docs[sid] ||= emptyServer());
  if (name === 'idx') d.idx = mergeIdx(d.idx, value);
  else if (name.startsWith('s.')) {
    const key = name.slice(2);
    d.series[key] = mergeSeries(d.series[key], value);
    const code = api.codeOf(sid);
    if (code) for (const [bookRaw, v] of Object.entries(d.series[key])) byBook.set(`${code}:${bookRaw}`, v);
    recount(d, key);
  }
}

const overlay = {
  progressOf(bookId) {
    const v = byBook.get(bookId);
    return live(v) ? { page: v[0], completed: !!v[1], readDate: new Date(v[2] * 1000).toISOString() } : undefined;
  },
  seriesStats(seriesId) {
    const v = docs[api.serverOf(seriesId)]?.idx.s[seriesKey(seriesId)];
    return { read: v ? v[0] : 0, inProgress: v ? v[1] : 0 };
  },
  /** Derniers chapitres ouverts, sous la forme attendue par les écrans. */
  recent() {
    return Object.values(docs).flatMap((d) => d.idx.r).sort((a, b) => b.t - a.t).map((e) => ({
      id: e.b, seriesId: e.s, seriesTitle: e.st, name: e.nm, number: e.n,
      media: { pagesCount: e.tot || 0 }, metadata: { title: e.nm, numberSort: e.n },
      readProgress: { page: e.p, completed: !!e.c, readDate: new Date(e.t * 1000).toISOString() },
    }));
  },
  record(book, page, completed, { now: immediately = false, quiet = false } = {}) {
    const sid = api.serverOf(book.id);
    const d = server(book.id);
    const key = seriesKey(book.seriesId);
    const t = now();
    const v = [page, completed ? 1 : 0, t];
    (d.series[key] ||= {})[raw(book.id)] = v;
    byBook.set(book.id, v);
    recount(d, key);
    if (!quiet) {
      d.idx.r = [{
        b: book.id, s: book.seriesId, st: book.seriesTitle, nm: book.metadata?.title || book.name,
        n: book.metadata?.numberSort ?? book.number, p: page, tot: book.media?.pagesCount || 0, c: v[1], t,
      }, ...d.idx.r.filter((e) => e.b !== book.id)].slice(0, RECENT_MAX);
    }
    touch(sid, key);
    // Un chapitre terminé part tout de suite ; une simple page tournée peut attendre.
    if (!quiet) schedule(immediately || completed);
  },
  forget(books) {
    for (const book of books) {
      const d = server(book.id);
      const key = seriesKey(book.seriesId);
      const v = [0, 0, now(), 1];
      (d.series[key] ||= {})[raw(book.id)] = v;
      byBook.set(book.id, v);
      prune(d);
      recount(d, key);
      touch(api.serverOf(book.id), key);
    }
    schedule(true);
  },
  flush,
};

let flushing = null;
async function flush() {
  clearTimeout(timer);
  flushing ??= (async () => {
    // Les documents de série d'abord : l'index est recalculé à partir d'eux.
    const items = [...dirty].sort((a, b) => a.endsWith('|idx') - b.endsWith('|idx'));
    for (const item of items) {
      const [sid, name] = item.split('|');
      const key = prefix() + name;
      // Lire avant d'écrire : un autre appareil a pu avancer entre-temps.
      // Tant que le serveur ne répond pas (hors ligne), l'élément reste à renvoyer.
      const remote = (await api.loadDocs(key))[sid]?.[key];
      if (remote !== undefined) absorb(sid, name, remote);
      const d = docs[sid] || emptyServer();
      if (name === 'idx') prune(d);
      await api.saveDoc(sid, key, JSON.stringify(name === 'idx' ? d.idx : d.series[name.slice(2)] || {}));
      dirty.delete(item);
    }
    mirror();
  })().finally(() => { flushing = null; });
  return flushing;
}

// ───────────── Chargement ─────────────

/** À appeler une fois les serveurs connectés. */
export async function load() {
  try {
    const remote = JSON.parse(await api.getClientSetting(LIST_KEY));
    if (Array.isArray(remote) && remote.some((p) => p.id === MAIN)) {
      profiles = remote;
      localStorage.setItem(LIST_MIRROR, JSON.stringify(profiles));
    }
  } catch { /* hors ligne, ou aucun profil créé : on garde la liste connue */ }
  if (!profiles.some((p) => p.id === activeId)) activeId = MAIN;
  if (!isExtra()) { api.setOverlay(null); return; }

  const local = readJson(mirrorKey(), { docs: {}, dirty: [] });
  docs = local.docs || {};
  (local.dirty || []).forEach((x) => dirty.add(x));
  index();
  try {
    const remote = await api.loadDocs(prefix());
    // Les séries avant l'index, pour que les compteurs soient recalculés sur des documents fusionnés.
    for (const [sid, map] of Object.entries(remote)) {
      const names = Object.keys(map).map((key) => key.slice(prefix().length));
      for (const name of names.filter((n) => n.startsWith('s.'))) absorb(sid, name, map[prefix() + name]);
      if (names.includes('idx')) {
        absorb(sid, 'idx', map[prefix() + 'idx']);
        for (const key of Object.keys(docs[sid].series)) recount(docs[sid], key);
        prune(docs[sid]);
      }
    }
  } catch { /* hors ligne : la copie locale suffit */ }
  mirror();
  api.setOverlay(overlay);
  if (dirty.size) flush().catch(() => {});
}
