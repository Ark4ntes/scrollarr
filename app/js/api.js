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
import { events, isReachable, retryNow, forgetServer, memo, normTitle, AuthError, OfflineError, ApiError } from './net.js';
import { idb } from './idb.js';

export { events, isReachable, retryNow, AuthError, OfflineError, ApiError };

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
/**
 * Vrai si un serveur activé sait ranger profils et abonnements (`settings.store`), même momentanément injoignable :
 * sans lui (installation « Dossiers » seule), ils restent sur cet appareil et l'écran ne propose pas de les gérer.
 */
export const hasStore = () => servers.some((s) => s.enabled && s.c.capabilities.includes(CAP.SETTINGS_STORE));
/** Vrai si chaque serveur utilisé sait dire où en est la lecture d'une série (filtre « Lecture » de la bibliothèque). */
export const canFilterByStatus = () => active().every((c) => c.capabilities.includes(CAP.PROGRESS_READ));
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

// Un lecteur « chapter.progress.profiles » tient lui-même la progression de chaque profil : on lui dit quel profil est
// ouvert, et la surcouche ne s'applique pas à ses chapitres (Suwayomi et Komga, eux, passent toujours par elle).
const keeps = (c) => c.capabilities.includes(CAP.PROGRESS_PROFILES);
const overlaid = (c) => !!overlay && !keeps(c);
let profileId = 'main';
export function setProfile(id) {
  profileId = id || 'main';
  for (const s of servers) if (keeps(s.c)) s.c.setProfile(profileId);
  merged.clear();
}

function tagSeries(c, s) {
  const out = { ...s, id: pid(c, s.id), libraryId: pid(c, s.libraryId), server: c.id };
  if (overlaid(c)) {
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
  if (overlaid(c)) out.readProgress = overlay.progressOf(out.id);
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
/**
 * Profil secondaire : ce que la surcouche sait (Suwayomi, Komga) plus ce que les lecteurs qui tiennent eux-mêmes
 * la progression de ce profil répondent, du plus récent au plus ancien. Un de ces lecteurs injoignable ne vide pas le reste.
 */
async function overlayBooks(method, size, own) {
  const owners = active().filter(keeps);
  const parts = owners.length ? await Promise.allSettled(owners.map((c) => c[method](size))) : [];
  const hide = owners.length ? await shadows().catch(() => new Map()) : new Map();
  const theirs = parts.flatMap((r, i) => (r.status === 'fulfilled'
    ? r.value.content.filter((b) => kept(hide, owners[i], b.seriesTitle)).map((b) => tagBook(owners[i], b)) : []));
  return { content: [...own, ...theirs].sort(byDateDesc((b) => b.readProgress?.readDate)).slice(0, size) };
}
export async function booksInProgress(size = 20) {
  if (!overlay) return mergedBooks('booksInProgress', size, (b) => b.readProgress?.readDate);
  return overlayBooks('booksInProgress', size, overlay.recent().filter((b) => reachable(b.id) && !b.readProgress.completed));
}
/** Derniers chapitres ouverts (en cours ou terminés), du plus récent au plus ancien. */
export async function booksRecentlyRead(size = 100) {
  if (!overlay) return mergedBooks('booksRecentlyRead', size, (b) => b.readProgress?.readDate);
  return overlayBooks('booksRecentlyRead', size, overlay.recent().filter((b) => reachable(b.id)));
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
// Une progression en attente pour un lecteur qui tient celle de chaque profil appartient au profil qui l'a faite :
// « idChapitre@profil » pour un profil secondaire, « idChapitre » pour le principal (et pour tous les autres lecteurs).
const queueKey = (bookId) => (profileId !== 'main' && keeps(find(bookId)) ? `${bookId}@${profileId}` : bookId);

/**
 * Enregistre la page courante. Hors ligne, la mise à jour est mise en file et
 * renvoyée au serveur dès qu'il redevient joignable.
 */
export async function saveProgress(bookId, page, completed, { keepalive = false, book: known } = {}) {
  // Lecteur sans « chapter.progress.write » : on lit, mais rien n'est enregistré (ni file, ni profil).
  if (!can(bookId, CAP.PROGRESS_WRITE)) return true;
  if (overlaid(find(bookId))) {
    overlay.record(known || (await book(bookId)), page, completed, { now: keepalive });
    return true;
  }
  const key = queueKey(bookId);
  const q = readQueue();
  q[key] = { page, completed, t: Date.now() };
  writeQueue(q);
  const settle = () => { const now = readQueue(); if (now[key]?.t === q[key].t) { delete now[key]; writeQueue(now); } };
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

export const pendingProgress = (bookId) => (overlaid(find(bookId)) ? undefined : readQueue()[queueKey(bookId)]);

export async function flushProgress() {
  if (overlay) await overlay.flush().catch(() => {});
  for (const [key, p] of Object.entries(readQueue())) {
    const [bookId, owner = 'main'] = key.split('@');
    if (owner !== profileId) continue; // la progression d'un autre profil attend que ce profil soit ouvert
    const ok = await saveProgress(bookId, p.page, p.completed).catch(() => true);
    if (!ok) break;
  }
  await retryForgets();
}

// ───────────── Oubli de la progression d'un profil supprimé ─────────────

const FORGET_KEY = 'scrollarr.forgetProfile'; // { idProfil: [idLecteur, …] } : ce qu'un lecteur injoignable n'a pas encore oublié
/** Demande à chaque lecteur qui tient la progression par profil de l'oublier ; ce qui échoue est réessayé plus tard. */
export async function forgetProfile(id) {
  const todo = readJson(FORGET_KEY, {});
  todo[id] = servers.filter((s) => s.available && keeps(s.c)).map((s) => s.c.id);
  localStorage.setItem(FORGET_KEY, JSON.stringify(todo));
  await retryForgets();
}
async function retryForgets() {
  const todo = readJson(FORGET_KEY, {});
  for (const [id, readers] of Object.entries(todo)) {
    const left = [];
    for (const rid of readers) {
      const s = servers.find((x) => x.c.id === rid);
      if (!s) continue;
      try { await s.c.forgetProfile(id); }
      // Route inconnue ou refusée pour de bon (service plus ancien) : inutile d'insister ; sinon, plus tard.
      catch (e) { if (!(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429)) left.push(rid); }
    }
    if (left.length) todo[id] = left; else delete todo[id];
  }
  localStorage.setItem(FORGET_KEY, JSON.stringify(todo));
}

function changing(method) {
  return async (id) => {
    const [c, raw] = route(id);
    if (!c.capabilities.includes(CAP.PROGRESS_WRITE)) return; // rien à enregistrer pour ce lecteur
    if (!overlaid(c)) await c[method](raw);
    else if (method === 'markBookRead') { const b = await book(id); overlay.record(b, b.media?.pagesCount || 1, true, { quiet: true }); }
    else if (method === 'markBookUnread') overlay.forget([await book(id)]);
    else if (method === 'markSeriesRead') (await seriesBooks(id)).forEach((b) => overlay.record(b, b.media?.pagesCount || 1, true, { quiet: true }));
    else overlay.forget(await seriesBooks(id));
    if (overlaid(c)) await overlay.flush().catch(() => {}); // hors ligne : renvoyé plus tard
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
/** Nom du collecteur qui téléchargerait les chapitres de cette série, pour le dire clairement à l'écran. */
export const serverDownloadLabel = (id) => collectorFor(find(id))?.label || '';
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
export const tasks = () => taskList.map((task) => ({
  ...task,
  collectorLabel: collectorLabel(task.collector),
  retryable: (task.state === 'failed' || task.state === 'cancelled') && collectorCan(task.collector, CAP.COLLECT_RETRY),
}));
const collectorCan = (id, cap) => { const k = collectors.find((x) => x.id === id); return !!k && k.capabilities.includes(cap) && collectorUsable(k); };
/** Nombre de tâches en attente ou en cours, pour le résumé affiché dans les réglages. */
export const activeTaskCount = () => taskList.filter(tasksModel.isActive).length;

/** Collecteurs de cette installation, pour l'écran de réglages. */
export const collectorList = () => collectors.map((k) => ({
  id: k.id, label: k.label, usable: collectorUsable(k), capabilities: k.capabilities,
  session: typeof k.session === 'string' ? servers.find((s) => s.c.id === k.session)?.c.label || k.session : null,
}));

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

/** Relance une tâche en échec ou annulée, si son collecteur le permet. */
export async function retryTask(id) {
  const task = taskList.find((x) => x.id === id);
  const k = task && collectors.find((x) => x.id === task.collector);
  if (!k || tasksModel.isActive(task) || !collectorCan(task.collector, CAP.COLLECT_RETRY)) throw new Error('Relance impossible');
  await k.retryTask(task.nativeId);
  await refreshTasks();
}

/** Vide l'historique. Les échecs que le collecteur garde dans sa file en sont retirés, sinon ils reviendraient. */
export async function clearTaskHistory() {
  for (const task of taskList.filter((x) => x.state === 'failed')) {
    if (collectorCan(task.collector, CAP.COLLECT_CANCEL)) await collectors.find((k) => k.id === task.collector).cancelTask(task.nativeId).catch(() => {});
  }
  setTasks(taskList.filter(tasksModel.isActive));
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
