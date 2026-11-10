// Façade de l'application vers ses serveurs. Les écrans n'appellent que ce
// module : il répartit chaque demande vers le bon connecteur et fusionne les
// listes quand plusieurs serveurs sont actifs.
//
// Chaque identifiant porte le code de son serveur en préfixe (« s:12 »,
// « k:0ABC… ») ; les connecteurs, eux, ne voient que leurs identifiants bruts.
import { READERS, COLLECTORS } from './connectors/index.js';
import { CAP } from './connectors/contract.js';
import { validateReader } from './connectors/reader-contract.js';
import { validateCollector } from './connectors/collector-contract.js';
import * as tasksModel from './tasks.js';
import { events, isReachable, forgetServer, memo, normTitle, AuthError, OfflineError, ApiError } from './net.js';
import { idb } from './idb.js';

export { events, isReachable, AuthError, OfflineError, ApiError };

const base = new URL('.', location.href).pathname;
const PREFS_KEY = 'scrollarr.servers';     // { [id]: false } pour un serveur désactivé par l'utilisateur
const AVAIL_KEY = 'scrollarr.available';   // dernière réponse connue de servers.json
const PRIMARY_KEY = 'scrollarr.primary';
const DEDUPE_KEY = 'scrollarr.dedupe';

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

/** { c: connecteur, available, enabled, state: 'off' | 'ok' | 'offline' | 'auth' | 'down', user } */
const servers = READERS.map((def) => ({ c: validateReader(def.create({ base: base + def.path })), available: false, enabled: false, state: 'off', user: null }));
// Les collecteurs sont à part : ils ne fournissent rien à lire, seulement de quoi alimenter un lecteur.
const collectors = COLLECTORS.map((def) => validateCollector(def.create({ base: base + def.path }), READERS.map((r) => r.id)));
const usable = (s) => s.state === 'ok' || s.state === 'offline';

// ───────────── Choix et état des serveurs ─────────────

/** Lit la liste des serveurs configurés sur cette installation (servers.json, produit par le proxy). */
export async function init() {
  let avail;
  try {
    const res = await fetch(base + 'servers.json', { cache: 'no-store' });
    if (res.ok) { avail = await res.json(); localStorage.setItem(AVAIL_KEY, JSON.stringify(avail)); }
  } catch { /* hors ligne : on reprend la dernière liste connue */ }
  // Sans servers.json (installation d'avant le multi-serveur), seul Komga existe.
  avail ??= readJson(AVAIL_KEY, { komga: true });
  const prefs = readJson(PREFS_KEY, {});
  for (const s of servers) {
    s.available = !!avail[s.c.id];
    s.enabled = s.available && prefs[s.c.id] !== false;
    if (!s.enabled) s.state = 'off';
  }
}

async function check(s) {
  try {
    const u = await s.c.session();
    s.state = u.offline ? 'offline' : 'ok';
    s.user = u.name;
  } catch (e) {
    s.state = e instanceof AuthError ? 'auth' : 'down';
  }
}

/** Vérifie la session de chaque serveur activé. */
export async function connect() {
  await Promise.all(servers.filter((s) => s.enabled).map(check));
  titles.clear();
  return serverList();
}

/** Vrai tant qu'un serveur activé attend une connexion, ou qu'aucun n'est utilisable. */
export const needsLogin = () => servers.some((s) => s.enabled && s.state === 'auth') || !servers.some(usable);

function primaryId() {
  const saved = localStorage.getItem(PRIMARY_KEY);
  return servers.some((s) => s.c.id === saved) ? saved : servers[0].c.id;
}
/** Connecteurs utilisables, le serveur prioritaire en tête. */
function active() {
  const first = primaryId();
  return servers.filter(usable).map((s) => s.c).sort((a, b) => (b.id === first) - (a.id === first));
}

export const serverList = () => servers.map((s) => ({
  id: s.c.id, label: s.c.label, userLabel: s.c.userLabel,
  available: s.available, enabled: s.enabled, state: s.state, user: s.user, primary: s.c.id === primaryId(),
  capabilities: s.c.capabilities,
}));
/** Vrai si le serveur auquel appartient cet identifiant annonce la capacité demandée. */
export const can = (id, capability) => find(id).capabilities.includes(capability);
export { CAP };

/** Revérifie un serveur à la demande et mesure son temps de réponse. */
export async function test(serverId) {
  const s = servers.find((x) => x.c.id === serverId);
  const start = performance.now();
  await check(s);
  if (s.state !== 'down') forgetServer(serverId);
  return { state: s.state, ms: Math.round(performance.now() - start) };
}
export const multi = () => active().length > 1;
/** Change dès que l'ensemble des serveurs utilisés (ou la règle des doublons) change. */
export const signature = () => active().map((c) => c.id).join('+') + (dedupe() ? '' : '+all');
/** Vrai si l'identifiant appartient à un serveur actuellement utilisable. */
export function reachable(id) { try { route(id); return true; } catch { return false; } }
export const serverLabel = (id) => find(id).label;
/** Identifiant du serveur auquel appartient un identifiant préfixé, et l'inverse. */
export const serverOf = (id) => find(id).id;
export const codeOf = (serverId) => servers.find((s) => s.c.id === serverId)?.c.code;
export const dedupe = () => localStorage.getItem(DEDUPE_KEY) !== '0';
export function setDedupe(on) { localStorage.setItem(DEDUPE_KEY, on ? '1' : '0'); titles.clear(); merged.clear(); }
export function setPrimary(id) { localStorage.setItem(PRIMARY_KEY, id); titles.clear(); merged.clear(); }

export async function setEnabled(id, on) {
  const s = servers.find((x) => x.c.id === id);
  const prefs = readJson(PREFS_KEY, {});
  if (on) delete prefs[id]; else prefs[id] = false;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  s.enabled = s.available && on;
  if (s.enabled) await check(s);
  else { s.state = 'off'; forgetServer(id); }
  titles.clear(); merged.clear();
}

export async function login(id, user, password) {
  const s = servers.find((x) => x.c.id === id);
  const u = await s.c.login(user, password);
  s.state = 'ok';
  s.user = u.name;
  titles.clear(); merged.clear();
}

/** Ferme la session d'un serveur, ou de tous. */
export async function logout(id) {
  for (const s of servers.filter((x) => (id ? x.c.id === id : x.enabled))) {
    await s.c.logout().catch(() => {});
    if (s.enabled) await check(s);
  }
  await idb.clear('apicache');
  titles.clear(); merged.clear();
}

events.addEventListener('unauthorized', (e) => {
  const s = servers.find((x) => x.c.id === e.detail);
  if (s?.enabled) s.state = 'auth';
});

// ───────────── Identifiants préfixés ─────────────

const pid = (c, raw) => (raw === undefined || raw === null ? raw : `${c.code}:${raw}`);
function find(id) {
  const code = String(id).split(':', 1)[0];
  const s = servers.find((x) => x.c.code === code);
  if (!s) throw new ApiError(404, 'Serveur inconnu');
  return s.c;
}
/** [connecteur, identifiant brut] — refuse un serveur désactivé ou déconnecté. */
function route(id) {
  const c = find(id);
  if (!usable(servers.find((s) => s.c === c))) throw new ApiError(404, 'Serveur non disponible');
  return [c, String(id).slice(c.code.length + 1)];
}
// Un profil secondaire tient son propre historique (voir profiles.js) : il se
// branche ici pour remplacer la progression venue du serveur par la sienne.
let overlay = null;
export function setOverlay(o) { overlay = o; merged.clear(); }

function tagSeries(c, s) {
  const out = { ...s, id: pid(c, s.id), libraryId: pid(c, s.libraryId), server: c.id };
  if (overlay) {
    const st = overlay.seriesStats(out.id);
    out.booksReadCount = Math.min(out.booksCount, st.read);
    out.booksInProgressCount = st.inProgress;
    out.booksUnreadCount = Math.max(0, out.booksCount - out.booksReadCount - st.inProgress);
  }
  return out;
}
function tagBook(c, b) {
  if (!b) return b;
  const out = { ...b, id: pid(c, b.id), seriesId: pid(c, b.seriesId), libraryId: pid(c, b.libraryId), server: c.id };
  if (overlay) out.readProgress = overlay.progressOf(out.id);
  return out;
}
const statusOf = (s) => (s.booksCount > 0 && s.booksReadCount >= s.booksCount ? 'READ'
  : s.booksReadCount + s.booksInProgressCount === 0 ? 'UNREAD' : 'IN_PROGRESS');

// ───────────── Fusion de plusieurs serveurs ─────────────

/** Appelle fn sur chaque serveur actif ; n'échoue que si tous échouent. */
async function gather(fn) {
  const list = active();
  const results = await Promise.allSettled(list.map((c) => fn(c)));
  if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  return results.flatMap((r, i) => (r.status === 'fulfilled' ? [[list[i], r.value]] : []));
}

async function everySeries(c, filters) {
  const out = [];
  for (let page = 0; page < 25; page++) {
    const res = await c.seriesList({ ...filters, page, size: 1000 });
    out.push(...res.content);
    if (res.last || !res.content.length) break;
  }
  return out;
}

// Titres déjà fournis par un serveur plus prioritaire : sert à masquer les doublons.
const titles = memo(60000);
async function shadows() {
  const list = active();
  const map = new Map(list.map((c) => [c.id, new Set()]));
  if (list.length < 2 || !dedupe()) return map;
  const seen = new Set();
  for (const c of list) {
    map.set(c.id, new Set(seen));
    if (c === list.at(-1)) break;
    const names = await titles(c.id, () => everySeries(c, {}).then((all) => all.map((s) => normTitle(s.metadata?.title || s.name))));
    names.forEach((n) => seen.add(n));
  }
  return map;
}
const kept = (map, c, title) => !map.get(c.id)?.has(normTitle(title));

const byDateDesc = (get) => (a, b) => (get(b) || '').localeCompare(get(a) || '');

async function mergedBooks(method, size, dateOf) {
  const [parts, hide] = await Promise.all([gather((c) => c[method](size)), shadows().catch(() => new Map())]);
  const items = parts.flatMap(([c, r]) => r.content.filter((b) => kept(hide, c, b.seriesTitle)).map((b) => tagBook(c, b)));
  if (dateOf && parts.length > 1) items.sort(byDateDesc(dateOf));
  return { content: items.slice(0, size) };
}
async function mergedSeries(method, size, dateOf) {
  const [parts, hide] = await Promise.all([gather((c) => c[method](size)), shadows().catch(() => new Map())]);
  const items = parts.flatMap(([c, r]) => r.content.filter((s) => kept(hide, c, s.metadata?.title || s.name)).map((s) => tagSeries(c, s)));
  if (parts.length > 1) items.sort(byDateDesc(dateOf));
  return { content: items.slice(0, size) };
}

// ───────────── Bibliothèque ─────────────

export async function libraries() {
  return (await gather((c) => c.libraries())).flatMap(([c, list]) => list.map((l) => ({ ...l, id: pid(c, l.id), server: c.id })));
}
export async function genres() {
  const all = (await gather((c) => c.genres())).flatMap(([, list]) => list);
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}

const merged = memo(20000);
const SORTERS = {
  title: (a, b) => (a.metadata?.title || a.name).localeCompare(b.metadata?.title || b.name, undefined, { sensitivity: 'base', numeric: true }),
  updated: byDateDesc((s) => s.lastModified),
  added: byDateDesc((s) => s.created),
};

export async function seriesList({ libraryId, page = 0, size = 30, ...filters } = {}) {
  const hide = await shadows().catch(() => new Map());
  const list = active();
  // Le serveur ne connaît pas l'état de lecture d'un profil secondaire : ce filtre se fait ici.
  const status = overlay ? filters.readStatus : undefined;
  if (status) delete filters.readStatus;
  // Un seul serveur concerné : on lui laisse la pagination.
  if (!status && (libraryId || list.length === 1)) {
    const [c, rawLib] = libraryId ? route(libraryId) : [list[0], undefined];
    const res = await c.seriesList({ ...filters, libraryId: rawLib, page, size });
    return { content: res.content.filter((s) => kept(hide, c, s.metadata?.title || s.name)).map((s) => tagSeries(c, s)), last: res.last };
  }
  // Plusieurs serveurs : on réunit tout, puis on trie et on découpe ici.
  const all = await merged(JSON.stringify([filters, libraryId, status]), async () => {
    const only = libraryId ? route(libraryId) : null;
    const parts = only ? [[only[0], await everySeries(only[0], { ...filters, libraryId: only[1] })]] : await gather((c) => everySeries(c, filters));
    let items = parts.flatMap(([c, rows]) => rows.filter((s) => kept(hide, c, s.metadata?.title || s.name)).map((s) => tagSeries(c, s)));
    if (status) items = items.filter((s) => statusOf(s) === status);
    // Une recherche garde l'ordre de pertinence de chaque serveur.
    return filters.search ? items : items.sort(SORTERS[filters.sort] || SORTERS.title);
  });
  return { content: all.slice(page * size, page * size + size), last: (page + 1) * size >= all.length };
}

export const seriesNew = (size = 20) => mergedSeries('seriesNew', size, (s) => s.created);
export const seriesUpdated = (size = 20) => mergedSeries('seriesUpdated', size, (s) => s.lastModified);
export async function series(id) { const [c, raw] = route(id); return tagSeries(c, await c.series(raw)); }
/** Tous les chapitres d'une série, dans l'ordre de lecture. */
export async function seriesBooks(id) { const [c, raw] = route(id); return (await c.seriesBooks(raw)).map((b) => tagBook(c, b)); }

export const booksLatest = (size = 20) => mergedBooks('booksLatest', size, (b) => b.created);
export async function booksOnDeck(size = 20) {
  if (!overlay) return mergedBooks('booksOnDeck', size);
  // Profil secondaire : la suite de chaque série dont le dernier chapitre ouvert est terminé.
  const seen = new Set();
  const last = overlay.recent().filter((b) => reachable(b.id) && !seen.has(b.seriesId) && seen.add(b.seriesId));
  const next = await Promise.all(last.filter((b) => b.readProgress.completed).slice(0, 8).map((b) => nextBook(b.id).catch(() => null)));
  return { content: next.filter((b) => b && !b.readProgress).slice(0, size) };
}
export async function booksInProgress(size = 20) {
  if (!overlay) return mergedBooks('booksInProgress', size, (b) => b.readProgress?.readDate);
  return { content: overlay.recent().filter((b) => reachable(b.id) && !b.readProgress.completed).slice(0, size) };
}
/** Derniers chapitres ouverts (en cours ou terminés), du plus récent au plus ancien. */
export async function booksRecentlyRead(size = 100) {
  if (!overlay) return mergedBooks('booksRecentlyRead', size, (b) => b.readProgress?.readDate);
  return { content: overlay.recent().filter((b) => reachable(b.id)).slice(0, size) };
}

export async function book(id) { const [c, raw] = route(id); return tagBook(c, await c.book(raw)); }
/** Pages d'un chapitre : [{ number, url, mediaType, width?, height?, fallbackUrl? }]. */
export function bookPages(id) { const [c, raw] = route(id); return c.bookPages(raw); }
export async function nextBook(id) { const [c, raw] = route(id); return tagBook(c, await c.nextBook(raw)); }
export async function previousBook(id) { const [c, raw] = route(id); return tagBook(c, await c.previousBook(raw)); }

// ───────────── Images ─────────────

const rawId = (c, id) => String(id).slice(c.code.length + 1);
export function seriesThumb(id) { const c = find(id); return c.seriesThumb(rawId(c, id)); }
export function bookThumb(id) { const c = find(id); return c.bookThumb(rawId(c, id)); }

// ───────────── Progression de lecture ─────────────

const QUEUE_KEY = 'scrollarr.progressQueue';
const readQueue = () => readJson(QUEUE_KEY, {});
const writeQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

/**
 * Enregistre la page courante. Hors ligne, la mise à jour est mise en file et
 * renvoyée au serveur dès qu'il redevient joignable.
 */
export async function saveProgress(bookId, page, completed, { keepalive = false, book: known } = {}) {
  if (overlay) {
    overlay.record(known || (await book(bookId)), page, completed, { now: keepalive });
    return true;
  }
  const q = readQueue();
  q[bookId] = { page, completed, t: Date.now() };
  writeQueue(q);
  const settle = () => { const now = readQueue(); if (now[bookId]?.t === q[bookId].t) { delete now[bookId]; writeQueue(now); } };
  try {
    const [c, raw] = route(bookId);
    await c.saveProgress(raw, page, completed, { keepalive });
    settle();
    return true;
  } catch (e) {
    if (e instanceof OfflineError) return false;
    // Rejet définitif (chapitre supprimé, serveur retiré…) : inutile de réessayer.
    settle();
    if (e instanceof AuthError) return false;
    throw e;
  }
}

export const pendingProgress = (bookId) => (overlay ? undefined : readQueue()[bookId]);

export async function flushProgress() {
  if (overlay) await overlay.flush().catch(() => {});
  for (const [bookId, p] of Object.entries(readQueue())) {
    const ok = await saveProgress(bookId, p.page, p.completed).catch(() => true);
    if (!ok) break;
  }
}

function changing(method) {
  return async (id) => {
    const [c, raw] = route(id);
    if (!overlay) await c[method](raw);
    else if (method === 'markBookRead') { const b = await book(id); overlay.record(b, b.media?.pagesCount || 1, true, { quiet: true }); }
    else if (method === 'markBookUnread') overlay.forget([await book(id)]);
    else if (method === 'markSeriesRead') (await seriesBooks(id)).forEach((b) => overlay.record(b, b.media?.pagesCount || 1, true, { quiet: true }));
    else overlay.forget(await seriesBooks(id));
    if (overlay) await overlay.flush().catch(() => {}); // hors ligne : renvoyé plus tard
    merged.clear();
  };
}
export const markBookRead = changing('markBookRead');
export const markBookUnread = changing('markBookUnread');
export const markSeriesRead = changing('markSeriesRead');
export const markSeriesUnread = changing('markSeriesUnread');

// ───────────── Téléchargement côté serveur (si le serveur sait le faire) ─────────────

// Un collecteur qui emprunte la session d'un lecteur n'est utilisable que si ce lecteur l'est.
const collectorUsable = (k) => typeof k.session !== 'string' || servers.some((s) => s.c.id === k.session && usable(s));
/** Collecteur capable de récupérer des chapitres désignés par les identifiants de ce lecteur. */
function collectorFor(reader) {
  return collectors.find((k) => k.capabilities.includes(CAP.COLLECT_CHAPTERS) && k.serves.includes(reader.id) && collectorUsable(k));
}
export const canServerDownload = (id) => !!collectorFor(find(id));
export async function serverDownload(bookIds) {
  if (!bookIds.length) return;
  const [c] = route(bookIds[0]);
  const collector = collectorFor(c);
  if (!collector) throw new Error('Aucun collecteur pour ce serveur');
  await collector.collectChapters(c.id, bookIds.map((id) => rawId(c, id)));
  refreshTasks().catch(() => {});
}

// ───────────── Tâches de collecte (modèle commun : tasks.js) ─────────────

const TASKS_KEY = 'scrollarr.tasks';
let taskList = readJson(TASKS_KEY, []);
export const taskEvents = new EventTarget();
function setTasks(list) {
  taskList = list;
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(list)); } catch { /* stockage plein : le suivi reste en mémoire */ }
  taskEvents.dispatchEvent(new Event('change'));
}
const trackers = () => collectors.filter((k) => k.capabilities.includes(CAP.COLLECT_TASKS) && collectorUsable(k));
const collectorLabel = (id) => collectors.find((k) => k.id === id)?.label || id;

/** Un collecteur parle avec les identifiants de son lecteur : on leur ajoute le préfixe de la façade. */
function toTask(k, raw) {
  const reader = servers.find((s) => s.c.id === raw.reader)?.c;
  return tasksModel.normalize(k.id, {
    ...raw,
    reader: reader ? raw.reader : null,
    seriesId: reader && raw.seriesId ? `${reader.code}:${raw.seriesId}` : null,
    chapterId: reader && raw.chapterId ? `${reader.code}:${raw.chapterId}` : null,
  });
}

/** Vrai si au moins un collecteur utilisable sait déclarer ses tâches. */
export const canTrackTasks = () => trackers().length > 0;
/** Tâches connues de cet appareil : en cours d'abord, puis les dernières terminées. */
export const tasks = () => taskList.map((task) => ({ ...task, collectorLabel: collectorLabel(task.collector) }));

/** Interroge les collecteurs et met la liste à jour. Un collecteur qui ne répond pas garde ses tâches en l'état. */
export async function refreshTasks() {
  let list = taskList;
  for (const k of trackers()) {
    try {
      const reports = (await k.tasks()).map((raw) => toTask(k, raw));
      list = tasksModel.reconcile(list, reports);
      const gone = tasksModel.missing(list, k.id, reports);
      if (gone.length) list = tasksModel.reconcile(list, (await k.resolveTasks(gone.map((task) => task.nativeId))).map((raw) => toTask(k, raw)));
    } catch (e) {
      if (!(e instanceof OfflineError) && !(e instanceof AuthError) && !(e instanceof ApiError)) throw e;
    }
  }
  if (JSON.stringify(list) !== JSON.stringify(taskList)) { setTasks(list); merged.clear(); }
  return tasks();
}

/** Annule une tâche, si son collecteur le permet. */
export async function cancelTask(id) {
  const task = taskList.find((x) => x.id === id);
  const k = task && collectors.find((x) => x.id === task.collector);
  if (!k || !task.cancellable || !k.capabilities.includes(CAP.COLLECT_CANCEL)) throw new Error('Annulation impossible');
  await k.cancelTask(task.nativeId);
  setTasks(tasksModel.cancelled(taskList, id));
}

// ───────────── Réglages conservés sur les serveurs ─────────────

// Petits documents texte rangés dans le stockage clé-valeur de chaque serveur
// (« meta » de Suwayomi, « client settings » de Komga). Suwayomi limite une
// valeur à 4096 caractères : les documents longs sont découpés en morceaux
// « clé », « clé.c1 », « clé.c2 »…, le premier annonçant leur nombre (« ~3~… »).
const CHUNK = 3500;
const isChunk = (key) => /\.c\d+$/.test(key);
function split(key, text) {
  const n = Math.max(1, Math.ceil(text.length / CHUNK));
  return Array.from({ length: n }, (_, i) => [i ? `${key}.c${i}` : key, (i || n === 1 ? '' : `~${n}~`) + text.slice(i * CHUNK, (i + 1) * CHUNK)]);
}
function join(map, key) {
  const head = map[key];
  const m = /^~(\d+)~/.exec(head || '');
  if (!m) return head;
  let text = head.slice(m[0].length);
  for (let i = 1; i < Number(m[1]); i++) text += map[`${key}.c${i}`] ?? '';
  return text;
}
const written = new Map(); // « serveur clé » → dernière valeur écrite, pour ne renvoyer que ce qui change

/** Tous les documents dont la clé commence par `prefix` : { idServeur: { clé: texte } }. */
const stores = (c) => c.capabilities.includes(CAP.SETTINGS_STORE);
/** Comme gather, mais limité aux serveurs qui offrent un stockage clé-valeur. */
async function gatherStores(fn) {
  const list = active().filter(stores);
  if (!list.length) return [];
  const results = await Promise.allSettled(list.map((c) => fn(c)));
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  return results.flatMap((r, i) => (r.status === 'fulfilled' ? [[list[i], r.value]] : []));
}

export async function loadDocs(prefix) {
  const out = {};
  for (const [c, map] of await gatherStores((c) => c.getSettings(prefix))) {
    for (const [k, v] of Object.entries(map)) written.set(`${c.id} ${k}`, v);
    out[c.id] = Object.fromEntries(Object.keys(map).filter((k) => !isChunk(k) || !(k.replace(/\.c\d+$/, '') in map)).map((k) => [k, join(map, k)]));
  }
  return out;
}
/** Écrit un document sur un serveur (ou sur tous les serveurs actifs si serverId est absent). */
export async function saveDoc(serverId, key, text) {
  const targets = active().filter((c) => stores(c) && (!serverId || c.id === serverId));
  if (!targets.length) throw new OfflineError('Serveur non disponible');
  const results = await Promise.allSettled(targets.map(async (c) => {
    for (const [k, v] of split(key, text)) {
      if (written.get(`${c.id} ${k}`) === v) continue;
      await c.setSetting(k, v);
      written.set(`${c.id} ${k}`, v);
    }
  }));
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
}
export async function deleteDocs(prefix) {
  for (const [c, map] of await gatherStores((c) => c.getSettings(prefix))) {
    const keys = Object.keys(map);
    if (keys.length) await c.deleteSettings(keys).catch(() => {});
    keys.forEach((k) => written.delete(`${c.id} ${k}`));
  }
}

/** Première valeur trouvée, en commençant par le serveur prioritaire. */
export async function getClientSetting(key) {
  const docs = await loadDocs(key);
  for (const c of active()) if (docs[c.id]?.[key] !== undefined) return docs[c.id][key];
  return undefined;
}
/** Écrit sur tous les serveurs actifs, pour que chacun puisse servir de source ensuite. */
export const setClientSetting = (key, value) => saveDoc(null, key, value);
