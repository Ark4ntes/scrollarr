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
import { mergeSeries, mergeIdx, mergeProfiles, compareStamp, deviceId } from './sync.js';

const LIST_KEY = 'scrollarr.profiles';
const ACTIVE_KEY = 'scrollarr.profile';
const LIST_MIRROR = 'scrollarr.profiles.cache';
const MAIN = 'main';
const RECENT_MAX = 40;

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

// `entries` garde aussi les profils supprimés (marque `del`), pour que la suppression
// se propage ; `profiles` ne contient que les profils vivants, ceux que l'on montre.
let entries = mergeProfiles(readJson(LIST_MIRROR, null), [{ id: MAIN, name: 'Principal' }]);
let profiles = entries.filter((p) => !p.del);
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

const setEntries = (next) => { entries = next; profiles = entries.filter((p) => !p.del); };
const stamped = (prev, fields) => ({ ...prev, ...fields, rev: (prev?.rev || 0) + 1, dev: deviceId() });
const parseList = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };

/**
 * Fusionne la liste de l'appareil avec celle de chaque serveur (et non avec celle du seul
 * serveur prioritaire, qui peut être en retard), puis recopie le résultat là où il diffère.
 * Un profil créé ailleurs n'est pas perdu, un profil supprimé exprès ne revient pas.
 */
async function syncList({ write }) {
  let remote = {};
  try { remote = await api.loadDocs(LIST_KEY); } catch { /* serveurs injoignables : on garde la liste connue */ }
  const texts = Object.values(remote).map((docs) => docs[LIST_KEY]).filter((x) => x !== undefined);
  setEntries(texts.reduce((acc, text) => mergeProfiles(acc, parseList(text)), entries));
  localStorage.setItem(LIST_MIRROR, JSON.stringify(entries));
  const text = JSON.stringify(entries);
  // Les serveurs en retard sont remis à niveau, sauf tant qu'il n'existe que le profil principal.
  const stale = entries.length > 1 && Object.values(remote).some((docs) => docs[LIST_KEY] !== text);
  if (write || stale) await api.setClientSetting(LIST_KEY, text);
}

export async function create(name) {
  const p = stamped(null, { id: 'p' + Math.random().toString(36).slice(2, 8), name: name.trim().slice(0, 30), added: Date.now() });
  setEntries([...entries, p]);
  // L'appareil qui crée un second profil garde le sien : pas besoin de lui redemander « Qui lit ? ».
  if (!localStorage.getItem(ACTIVE_KEY)) localStorage.setItem(ACTIVE_KEY, activeId);
  localStorage.setItem(LIST_MIRROR, JSON.stringify(entries));
  await syncList({ write: true });
  return p;
}
export async function rename(id, name) {
  setEntries(entries.map((p) => (p.id === id ? stamped(p, { name: name.trim().slice(0, 30) }) : p)));
  localStorage.setItem(LIST_MIRROR, JSON.stringify(entries));
  await syncList({ write: true });
}
/** Supprime un profil secondaire et tout son historique. */
export async function remove(id) {
  if (id === MAIN) return;
  setEntries(entries.map((p) => (p.id === id ? stamped(p, { del: 1 }) : p)));
  localStorage.setItem(LIST_MIRROR, JSON.stringify(entries));
  await syncList({ write: true });
  await api.deleteDocs(prefix(id)).catch(() => {});
  await api.forgetProfile(id).catch(() => {}); // Dossiers range la progression chez lui ; ce qui échoue est réessayé
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
//   s.<clé>  { idChapitre: [page, terminé (0/1), date, effacé (0/1), révision, appareil] }
//
// Deux appareils peuvent lire sous le même profil. Chaque entrée porte donc
// une révision et l'appareil qui l'a écrite (voir sync.js), et tout échange
// avec le serveur est une fusion entrée par entrée plutôt qu'un remplacement
// du document. Une entrée effacée laisse une marque, sinon l'autre appareil
// la ferait revenir.

let docs = {};            // { idServeur: { idx, series: { cléSérie: {…} } } }
// « idServeur|idx » ou « idServeur|s.<clé> » à renvoyer au serveur → numéro de la dernière modification.
// Ce numéro permet de savoir, à la fin d'une écriture, si le document a encore changé entre-temps.
const dirty = new Map();
const byBook = new Map(); // idChapitre préfixé → [page, terminé, date, effacé ?]
let timer = 0;

const raw = (id) => String(id).slice(String(id).indexOf(':') + 1);
// Komga n'accepte que des clés en minuscules, segments alphanumériques.
const seriesKey = (seriesId) => raw(seriesId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const emptyServer = () => ({ idx: { s: {}, r: [] }, series: {} });
const server = (id) => (docs[api.serverOf(id)] ||= emptyServer());
const live = (v) => !!v && !v[3];
const now = () => Math.floor(Date.now() / 1000);

function mirror() {
  try { localStorage.setItem(mirrorKey(), JSON.stringify({ docs, dirty: [...dirty.keys()] })); } catch { /* stockage plein : la copie locale est facultative */ }
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
  d.idx.r = d.idx.r.filter((e) => { const v = byBook.get(e.b); return !v || live(v) || compareStamp(v[4], v[5], e.v, e.d) < 0; });
}
function touch(sid, key) {
  for (const item of [`${sid}|idx`, `${sid}|s.${key}`]) dirty.set(item, (dirty.get(item) || 0) + 1);
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
  if (name === 'idx') d.idx = mergeIdx(d.idx, value, RECENT_MAX);
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
    const prev = (d.series[key] ||= {})[raw(book.id)];
    // La révision n'avance que lorsque l'entrée change de main ou d'état :
    // tourner les pages d'un chapitre déjà à soi ne la fait pas grimper, sinon
    // l'appareil qui écrit le plus souvent l'emporterait toujours sur un autre.
    const mine = prev && prev[5] === deviceId() && !prev[3] && !!prev[1] === !!completed;
    const rev = (prev?.[4] || 0) + (mine ? 0 : 1);
    const v = [page, completed ? 1 : 0, mine ? Math.max(t, prev[2]) : t, 0, rev, deviceId()];
    d.series[key][raw(book.id)] = v;
    byBook.set(book.id, v);
    recount(d, key);
    if (!quiet) {
      d.idx.r = [{
        b: book.id, s: book.seriesId, st: book.seriesTitle, nm: book.metadata?.title || book.name,
        n: book.metadata?.numberSort ?? book.number, p: page, tot: book.media?.pagesCount || 0, c: v[1], t, v: rev, d: v[5],
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
      const rev = ((d.series[key] ||= {})[raw(book.id)]?.[4] || 0) + 1;
      const v = [0, 0, now(), 1, rev, deviceId()];
      d.series[key][raw(book.id)] = v;
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
  let again = false; // un document a changé pendant son écriture : il part au passage suivant
  flushing ??= (async () => {
    // Les documents de série d'abord : l'index est recalculé à partir d'eux.
    const items = [...dirty.keys()].sort((a, b) => a.endsWith('|idx') - b.endsWith('|idx'));
    let failure;
    for (const item of items) {
      // Chaque document est indépendant : un serveur qui ne peut pas stocker le sien
      // (arrêté, ou sans stockage) ne doit pas bloquer l'envoi des autres.
      try {
        const [sid, name] = item.split('|');
        const key = prefix() + name;
        // Lire avant d'écrire : un autre appareil a pu avancer entre-temps.
        // Tant que le serveur ne répond pas (hors ligne), l'élément reste à renvoyer.
        const remote = (await api.loadDocs(key))[sid]?.[key];
        if (remote !== undefined) absorb(sid, name, remote);
        const d = docs[sid] || emptyServer();
        if (name === 'idx') {
          // Les compteurs se déduisent des documents de série, qui font foi.
          for (const k of Object.keys(d.series)) recount(d, k);
          prune(d);
        }
        // Numéro relevé au moment exact où le contenu est figé pour l'envoi.
        const sent = dirty.get(item);
        await api.saveDoc(sid, key, JSON.stringify(name === 'idx' ? d.idx : d.series[name.slice(2)] || {}));
        // Si le document a encore changé pendant l'écriture, il reste à renvoyer.
        if (dirty.get(item) === sent) dirty.delete(item); else again = true;
      } catch (e) { failure ??= e; } // l'élément reste à renvoyer, on passe au suivant
    }
    if ([...dirty.keys()].some((k) => !items.includes(k))) again = true; // document apparu pendant le passage
    mirror();
    if (failure) throw failure;
  })().finally(() => {
    flushing = null;
    mirror(); // même après un échec : ce qui n'est pas parti doit survivre à un rechargement
    // Ce qui a été modifié pendant ce passage part au suivant. Un document en échec
    // (hors ligne, serveur sans stockage) n'est pas réessayé en boucle : il attend
    // le retour du réseau ou la prochaine modification.
    if (again) { clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 1500); }
  });
  return flushing;
}

// ───────────── Chargement ─────────────

/** À appeler une fois les serveurs connectés. */
export async function load() {
  try { await syncList({ write: false }); }
  catch { /* hors ligne, ou aucun profil créé : on garde la liste connue */ }
  if (!profiles.some((p) => p.id === activeId)) activeId = MAIN;
  api.setProfile(activeId); // les lecteurs qui tiennent la progression par profil (Dossiers) en ont besoin avant toute lecture
  if (!isExtra()) { api.setOverlay(null); return; }

  const local = readJson(mirrorKey(), { docs: {}, dirty: [] });
  docs = local.docs || {};
  (local.dirty || []).forEach((x) => dirty.set(x, 1));
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
