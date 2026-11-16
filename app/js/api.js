// Façade de l'application vers ses serveurs. Les écrans n'appellent que ce
// module : il répartit chaque demande vers le bon connecteur et fusionne les
// listes quand plusieurs serveurs sont actifs.
//
// Chaque identifiant porte le code de son serveur en préfixe (« s:12 »,
// « k:0ABC… ») ; les connecteurs, eux, ne voient que leurs identifiants bruts.
import { READERS, COLLECTORS } from './connectors/index.js';
import { CAP } from './connectors/contract.js';
import { validateReader } from './connectors/reader-contract.js';
import { validateCollector, normalizeSource, normalizeSearch, normalizeAdded } from './connectors/collector-contract.js';
import * as tasksModel from './tasks.js';
import { deviceId } from './sync.js';
import * as matching from './matching.js';
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
  syncMatches(false).catch(() => {});
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
export const signature = () => active().map((c) => c.id).join('+') + (dedupe() ? '+m' + matchRev : '+all');
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

// ───────────── Séries en double ─────────────
// Une série d'un serveur moins prioritaire est masquée quand le même ouvrage existe chez un serveur plus
// prioritaire. Trois règles, dans cet ordre (voir matching.js pour les décisions manuelles) :
//  1. une décision « pas la même série » protège la paire : l'égalité des titres ne la masque pas ;
//  2. une décision « même série » masque les membres du groupe des serveurs moins prioritaires ;
//  3. sinon, des titres égaux une fois normalisés (règle d'origine, inchangée).
// Le réglage « Afficher les deux » coupe tout, décisions comprises.
const titleOf = (s) => s.metadata?.title || s.name || '';
// Séries de chaque serveur (identifiant natif, titre, titre normalisé). Ne dépend pas des décisions : elles
// sont relues à chaque calcul, seules les listes fusionnées (`merged`) sont à vider quand elles changent.
const titles = memo(60000);
const inventory = (c) => titles(c.id, () => everySeries(c, {}).then((all) => {
  const byId = new Map();
  const byNorm = new Map();
  for (const s of all) {
    const e = { id: String(s.id), title: titleOf(s), norm: normTitle(titleOf(s)) };
    byId.set(e.id, e);
    if (!byNorm.has(e.norm)) byNorm.set(e.norm, []);
    byNorm.get(e.norm).push(e);
  }
  return { byId, byNorm };
}));

const NO_HIDE = { on: false, verdict: () => null, list: [], inv: new Map() };
/**
 * Ce qui masque quoi. `verdict(connecteur, idNatif, titre)` renvoie null (la série s'affiche) ou
 * { reason: 'auto' | 'manual', by: { server, id, title } } : la série qui reste à sa place.
 * L'inventaire du dernier serveur n'est lu que si `all` : il ne masque rien, mais on veut parfois le lister.
 */
async function shadows({ all = false, doc = matchDoc } = {}) {
  const list = active();
  if (list.length < 2 || !dedupe()) return NO_HIDE;
  const inv = new Map(await Promise.all((all ? list : list.slice(0, -1)).map(async (c) => [c.id, await inventory(c)])));
  const rank = new Map(list.map((c, i) => [c.id, i]));
  const { of } = matching.groups(doc);
  const diffs = matching.diffPairs(doc);
  const verdict = (c, rawId, title) => {
    const mine = rank.get(c.id);
    if (mine === undefined) return null;
    const me = { s: c.id, i: String(rawId ?? '') };
    const group = rawId === undefined || rawId === null ? null : of.get(matching.refKey(me));
    if (group) {
      // Une série qui n'existe plus (dossier renommé) ne masque personne.
      const best = group.members.filter((m) => rank.get(m.s) < mine && inv.get(m.s)?.byId.has(m.i))
        .sort((x, y) => rank.get(x.s) - rank.get(y.s))[0];
      if (best) return { reason: 'manual', by: { server: best.s, id: best.i, title: inv.get(best.s).byId.get(best.i).title } };
    }
    const norm = normTitle(title);
    for (const c2 of list.slice(0, mine)) {
      const hit = inv.get(c2.id)?.byNorm.get(norm)?.find((y) => !diffs.has(matching.pairKey(me, { s: c2.id, i: y.id })));
      if (hit) return { reason: 'auto', by: { server: c2.id, id: hit.id, title: hit.title } };
    }
    return null;
  };
  return { on: true, verdict, list, inv };
}
const kept = (plan, c, rawId, title) => !plan.verdict(c, rawId, title);

const byDateDesc = (get) => (a, b) => (get(b) || '').localeCompare(get(a) || '');

async function mergedBooks(method, size, dateOf) {
  const [parts, hide] = await Promise.all([gather((c) => c[method](size)), shadows().catch(() => NO_HIDE)]);
  const items = parts.flatMap(([c, r]) => r.content.filter((b) => kept(hide, c, b.seriesId, b.seriesTitle)).map((b) => tagBook(c, b)));
  if (dateOf && parts.length > 1) items.sort(byDateDesc(dateOf));
  return { content: items.slice(0, size) };
}
async function mergedSeries(method, size, dateOf) {
  const [parts, hide] = await Promise.all([gather((c) => c[method](size)), shadows().catch(() => NO_HIDE)]);
  const items = parts.flatMap(([c, r]) => r.content.filter((s) => kept(hide, c, s.id, titleOf(s))).map((s) => tagSeries(c, s)));
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
  const hide = await shadows().catch(() => NO_HIDE);
  const list = active();
  // Le serveur ne connaît pas l'état de lecture d'un profil secondaire : ce filtre se fait ici.
  const status = overlay ? filters.readStatus : undefined;
  if (status) delete filters.readStatus;
  // Un seul serveur concerné : on lui laisse la pagination.
  if (!status && (libraryId || list.length === 1)) {
    const [c, rawLib] = libraryId ? route(libraryId) : [list[0], undefined];
    const res = await c.seriesList({ ...filters, libraryId: rawLib, page, size });
    return { content: res.content.filter((s) => kept(hide, c, s.id, titleOf(s))).map((s) => tagSeries(c, s)), last: res.last };
  }
  // Plusieurs serveurs : on réunit tout, puis on trie et on découpe ici.
  const all = await merged(JSON.stringify([filters, libraryId, status]), async () => {
    const only = libraryId ? route(libraryId) : null;
    const parts = only ? [[only[0], await everySeries(only[0], { ...filters, libraryId: only[1] })]] : await gather((c) => everySeries(c, filters));
    let items = parts.flatMap(([c, rows]) => rows.filter((s) => kept(hide, c, s.id, titleOf(s))).map((s) => tagSeries(c, s)));
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
  const hide = owners.length ? await shadows().catch(() => NO_HIDE) : NO_HIDE;
  const theirs = parts.flatMap((r, i) => (r.status === 'fulfilled'
    ? r.value.content.filter((b) => kept(hide, owners[i], b.seriesId, b.seriesTitle)).map((b) => tagBook(owners[i], b)) : []));
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

// ───────────── Chercher chez les sources et ajouter une série ─────────────

// Un collecteur qui sait chercher par titre (collect.search). Aujourd'hui un seul : on prend le premier utilisable.
// Rien n'est envoyé aux sources sans appel explicite de l'écran : ces fonctions ne sont jamais appelées en arrière-plan.
const searcher = () => collectors.find((k) => k.capabilities.includes(CAP.COLLECT_SEARCH) && collectorUsable(k));
const needSearcher = () => searcher() || (() => { throw new Error('Aucun collecteur ne sait chercher'); })();
/** Vrai si un collecteur utilisable sait chercher par titre : sinon l'écran de recherche n'en parle pas. */
export const canSearchSources = () => !!searcher();
/** Identifiant et nom du collecteur qui chercherait. */
export const searchCollector = () => { const k = searcher(); return k ? { id: k.id, label: k.label } : null; };
/** La recherche a besoin du serveur : hors ligne ou serveur injoignable, elle n'est pas proposée. */
export const canSearchNow = () => canSearchSources() && isReachable() && navigator.onLine !== false;

const sourceLists = memo(60000);
/** Les sources du collecteur, au format du contrat. Lecture locale sur le serveur : aucune source n'est contactée. */
export function sources() {
  const k = needSearcher();
  return sourceLists(k.id, async () => (await k.sources()).map((s) => normalizeSource(k, s)));
}

/** Les identifiants de série du collecteur sont ceux d'un lecteur : on y met le préfixe de la façade. */
function tagResult(k, r) {
  const reader = r.reader && servers.find((s) => s.c.id === r.reader)?.c;
  return { ...r, collector: k.id, reader: reader ? r.reader : null, seriesId: reader && r.seriesId ? `${reader.code}:${r.seriesId}` : null };
}
/** Cherche un titre dans une source. Lève une erreur pour cette source seule. */
export async function searchSource(sourceId, query) {
  const k = needSearcher();
  const res = normalizeSearch(k, await k.search(sourceId, query));
  return { more: res.more, results: res.results.map((r) => tagResult(k, r)) };
}

/**
 * Ajoute un résultat. La série apparaît ensuite dans la bibliothèque : les mémoires du lecteur et de la façade sont
 * vidées. Renvoie l'identifiant de la série (préfixé), ou null si le collecteur n'a pas de série à ouvrir.
 */
export async function addFromSource(result) {
  const k = collectors.find((x) => x.id === result.collector && x.capabilities.includes(CAP.COLLECT_ADD) && collectorUsable(x));
  if (!k) throw new Error('Ajout impossible');
  const added = normalizeAdded(k, await k.add(result.id));
  titles.clear(); merged.clear();
  const { seriesId } = tagResult(k, { ...added, inLibrary: true });
  return { seriesId, complete: added.complete };
}

// ───────────── Tâches de collecte (modèle commun : tasks.js) ─────────────

const TASKS_KEY = 'scrollarr.tasks';
let taskList = readJson(TASKS_KEY, []);
export const taskEvents = new EventTarget();
// Pierres tombales de « Effacer l'historique » (voir tasks.js), conservées avec la liste.
const CLEARED_KEY = 'scrollarr.tasks.cleared';
let taskCleared = readJson(CLEARED_KEY, {});
/** Remplace la liste locale. Si ce qui est partagé change (tâches terminées, effacements), prépare l'envoi aux serveurs. */
function setTasks(list, { cleared = taskCleared, share = true } = {}) {
  const before = share ? JSON.stringify(tasksModel.sharedView({ tasks: taskList, cleared: taskCleared })) : null;
  taskList = list;
  taskCleared = cleared;
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(list));
    localStorage.setItem(CLEARED_KEY, JSON.stringify(cleared));
  } catch { /* stockage plein : le suivi reste en mémoire */ }
  taskEvents.dispatchEvent(new Event('change'));
  if (share && JSON.stringify(tasksModel.sharedView({ tasks: taskList, cleared: taskCleared })) !== before) { taskGen++; pushTasks(); }
}

// Historique partagé : un seul document pour toute l'installation (les tâches
// sont celles du collecteur, pas d'un profil), rangé dans le stockage
// clé-valeur des serveurs comme les abonnements. Lecture, fusion, écriture ;
// un changement local pendant l'échange repart ensuite. Les échecs sont
// silencieux et réessayés plus tard. Sans stockage, l'historique reste par appareil.
const TASKS_DOC = 'scrollarr.tasks';
let taskGen = 0;          // augmente à chaque changement local de ce qui est partagé
let taskSyncing = false;
let taskPulledAt = 0;
let taskPushTimer;
const pushTasks = () => { clearTimeout(taskPushTimer); taskPushTimer = setTimeout(() => syncTasks(true), 800); };
async function syncTasks(write) {
  if (taskSyncing || !hasStore() || !canTrackTasks()) return false;
  taskSyncing = true;
  try {
    let text;
    try { text = await getClientSetting(TASKS_DOC); } catch { return false; } // serveur injoignable : on réessaiera, sans rien écraser
    let remote = null;
    try { remote = JSON.parse(text); } catch { /* rien d'enregistré */ }
    taskPulledAt = Date.now();
    const gen = taskGen;
    const union = tasksModel.mergeTasks({ tasks: taskList, cleared: taskCleared }, remote);
    if (JSON.stringify(union) !== JSON.stringify({ tasks: taskList, cleared: taskCleared })) { setTasks(union.tasks, { cleared: union.cleared, share: false }); merged.clear(); }
    const doc = JSON.stringify(tasksModel.sharedView(union));
    if (write || doc !== JSON.stringify(tasksModel.sharedView(remote))) {
      try { await setClientSetting(TASKS_DOC, doc); } catch { taskPulledAt = 0; return false; }
    }
    if (taskGen !== gen) pushTasks();
    return true;
  } finally { taskSyncing = false; }
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
  // Où en est la relance automatique ; rien à dire quand elle est désactivée.
  autoRetry: autoRetryEnabled()
    ? tasksModel.retryPlan(task, { canRetry: collectorCan(task.collector, CAP.COLLECT_RETRY), device: deviceId(), opts: retryOpts() })
    : { status: 'none', at: null },
}));

// ── Relance automatique (politique pure : tasks.js) ──
// Réglage de cet appareil. Activé par défaut ; « 0 » le coupe.
const AUTO_RETRY_KEY = 'scrollarr.autoRetry';
export const autoRetryEnabled = () => { try { return localStorage.getItem(AUTO_RETRY_KEY) !== '0'; } catch { return true; } };
export function setAutoRetry(on) {
  try { localStorage.setItem(AUTO_RETRY_KEY, on ? '1' : '0'); } catch { /* réglage non conservé */ }
  taskEvents.dispatchEvent(new Event('change'));
  if (on) refreshTasks().catch(() => {});
}
/**
 * Délais de la politique. Réservé aux tests et au développement : la clé
 * `scrollarr.dev.retry` (JSON { delays, jitterMs, claimMs }) n'est écrite par
 * aucun écran, un utilisateur ne peut pas la poser par inadvertance
 * (voir docs/fr/development.md). Une valeur invalide est ignorée.
 */
function retryOpts() {
  try {
    const o = JSON.parse(localStorage.getItem('scrollarr.dev.retry'));
    const ok = (a) => Array.isArray(a) && a.length > 0 && a.every((n) => Number.isFinite(n) && n >= 0);
    if (o && ok(o.delays)) {
      return { ...tasksModel.RETRY, delays: o.delays, jitterMs: Number.isFinite(o.jitterMs) ? o.jitterMs : tasksModel.RETRY.jitterMs, claimMs: Number.isFinite(o.claimMs) ? o.claimMs : tasksModel.RETRY.claimMs };
    }
  } catch { /* clé absente ou illisible */ }
  return tasksModel.RETRY;
}
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
      list = tasksModel.reconcile(list, reports, { retry: retryOpts() });
      const gone = tasksModel.missing(list, k.id, reports);
      if (gone.length) list = tasksModel.reconcile(list, (await k.resolveTasks(gone.map((task) => task.nativeId))).map((raw) => toTask(k, raw)), { retry: retryOpts() });
    } catch (e) {
      if (!(e instanceof OfflineError) && !(e instanceof AuthError) && !(e instanceof ApiError)) throw e;
    }
  }
  if (JSON.stringify(list) !== JSON.stringify(taskList)) { setTasks(list); merged.clear(); }
  if (Date.now() - taskPulledAt > 15000) syncTasks(false).catch(() => {}); // sans attendre : l'écran ne dépend pas des serveurs
  await autoRetryPass();
  return tasks();
}

// Relance automatique des échecs. Sans serveur à nous, elle n'a lieu que lorsque
// l'application est ouverte quelque part : refreshTasks tourne quand l'écran des
// téléchargements est affiché, à l'ouverture des réglages et après une demande.
// Jamais hors connexion, jamais si le collecteur est inutilisable, quelques
// relances au plus par passage, et aucune erreur n'en sort.
let autoRetrying = false;
async function autoRetryPass() {
  if (autoRetrying || !autoRetryEnabled() || !isReachable() || navigator.onLine === false) return;
  autoRetrying = true;
  try {
    const opts = retryOpts(), me = deviceId();
    let sent = 0;
    for (const task of taskList.filter((x) => x.state === 'failed')) {
      if (sent >= opts.maxPerPass) break;
      if (tasksModel.retryPlan(task, { canRetry: collectorCan(task.collector, CAP.COLLECT_RETRY), device: me, opts }).status !== 'due') continue;
      try {
        if (hasStore()) {
          // Réservation partagée puis relecture : voir `claimed` dans tasks.js.
          setTasks(tasksModel.claimed(taskList, task.id, me, { opts }));
          if (!(await syncTasks(true))) continue;
          const now = taskList.find((x) => x.id === task.id);
          if (!now || now.state !== 'failed' || now.claimBy !== me) continue;
        }
        await retryTask(task.id, { auto: true });
        sent++;
      } catch { /* une relance qui échoue sera reprise plus tard : la réservation expire */ }
    }
  } finally { autoRetrying = false; }
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
export async function retryTask(id, { auto = false } = {}) {
  const task = taskList.find((x) => x.id === id);
  const k = task && collectors.find((x) => x.id === task.collector);
  if (!k || tasksModel.isActive(task) || !collectorCan(task.collector, CAP.COLLECT_RETRY)) throw new Error('Relance impossible');
  await k.retryTask(task.nativeId);
  // Une relance manuelle remet le compte des relances automatiques à zéro ; une automatique en ajoute une.
  setTasks(tasksModel.retried(taskList, id, { auto }));
  await refreshTasks();
}

/** Vide l'historique. Les échecs que le collecteur garde dans sa file en sont retirés, sinon ils reviendraient. */
export async function clearTaskHistory() {
  for (const task of taskList.filter((x) => x.state === 'failed')) {
    if (collectorCan(task.collector, CAP.COLLECT_CANCEL)) await collectors.find((k) => k.id === task.collector).cancelTask(task.nativeId).catch(() => {});
  }
  // Les tâches effacées laissent une pierre tombale, pour que les autres appareils ne les ramènent pas.
  const cleared = { ...taskCleared };
  for (const task of taskList.filter(tasksModel.isFinished)) cleared[task.id] = Math.max(cleared[task.id] ?? 0, task.finishedAt || 0);
  setTasks(taskList.filter(tasksModel.isActive), { cleared });
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

// ───────────── Décisions manuelles sur les séries en double ─────────────
// « Ces séries sont la même » / « ce ne sont pas la même » (modèle et règles : matching.js). Un seul document pour
// toute l'installation (pas par profil), rangé dans le stockage clé-valeur des serveurs comme les abonnements : lecture,
// fusion, écriture, et un changement local pendant l'échange repart ensuite. Les échecs sont silencieux et réessayés
// plus tard. Sans serveur qui sache ranger (installation « Dossiers » seule), les décisions restent sur l'appareil.
// Le premier échange tient lieu de migration : le document local et celui des serveurs sont simplement fusionnés.
const MATCH_KEY = 'scrollarr.matches'; // copie de l'appareil, et clé du document sur les serveurs
let matchDoc = matching.sanitize(readJson(MATCH_KEY, null));
let matchRev = 0;         // change à chaque modification du document : entre dans signature()
let matchGen = 0;         // augmente à chaque changement local, pour repérer ceux qui arrivent pendant un échange
let matchSyncing = false;
let matchPulledAt = 0;
let matchPushTimer;
/** Événement « change » à chaque modification ; detail.remote vaut vrai si elle vient d'un autre appareil. */
export const matchEvents = new EventTarget();
const matchCtx = () => ({ device: deviceId(), now: Date.now() });

function setMatchDoc(doc, { share = true, remote = false } = {}) {
  matchDoc = doc;
  matchRev++;
  try { localStorage.setItem(MATCH_KEY, JSON.stringify(doc)); } catch { /* stockage plein : le document reste en mémoire */ }
  merged.clear();
  matchEvents.dispatchEvent(new CustomEvent('change', { detail: { remote } }));
  if (share) { matchGen++; pushMatches(); }
}
function pushMatches() { clearTimeout(matchPushTimer); matchPushTimer = setTimeout(() => syncMatches(true).catch(() => {}), 800); }

/** Échange avec les serveurs. Sans `force`, pas plus d'une lecture toutes les 15 secondes. Renvoie vrai si l'échange a eu lieu. */
export async function syncMatches(write = false, { force = false } = {}) {
  if (matchSyncing || !hasStore()) return false;
  if (!write && !force && Date.now() - matchPulledAt < 15000) return false;
  matchSyncing = true;
  try {
    let text;
    try { text = await getClientSetting(MATCH_KEY); } catch { return false; } // serveur injoignable : on réessaiera, sans rien écraser
    let remote = null;
    try { remote = JSON.parse(text); } catch { /* rien d'enregistré */ }
    matchPulledAt = Date.now();
    const gen = matchGen;
    const union = matching.mergeDocs(matchDoc, remote);
    if (JSON.stringify(union) !== JSON.stringify(matchDoc)) setMatchDoc(union, { share: false, remote: true });
    if (write || JSON.stringify(union) !== JSON.stringify(matching.sanitize(remote))) {
      try { await setClientSetting(MATCH_KEY, JSON.stringify(union)); } catch { matchPulledAt = 0; return false; }
    }
    if (matchGen !== gen) pushMatches();
    return true;
  } finally { matchSyncing = false; }
}

const refOf = (s) => { const c = find(s.id); return matching.ref(c.id, rawId(c, s.id), s.title); };
const prefixed = (serverId, raw) => { const c = servers.find((s) => s.c.id === serverId).c; return pid(c, raw); };
const connector = (serverId) => servers.find((s) => s.c.id === serverId)?.c;
const place = (by) => ({ id: prefixed(by.server, by.id), server: by.server, serverLabel: connector(by.server)?.label || by.server, title: by.title });

/** Nombre de décisions manuelles actives. */
export const matchCount = () => matching.entries(matchDoc).length;

/**
 * Ce que la façade sait des doublons d'une série affichée : de quelle série elle est masquée (hiddenBy, ou null), et
 * quelles copies elle masque (hides : serveur, titre, identifiant, raison « auto » ou « manual »). Vide quand le réglage
 * « Afficher les deux » est choisi ou qu'un seul serveur est utilisé.
 */
export async function copies(id, title) {
  const out = { hiddenBy: null, hides: [] };
  const [c, raw] = route(id);
  const plan = await shadows({ all: true });
  if (!plan.on) return out;
  const v = plan.verdict(c, raw, title ?? plan.inv.get(c.id)?.byId.get(raw)?.title ?? '');
  if (v) out.hiddenBy = { ...place(v.by), reason: v.reason };
  const mine = plan.list.findIndex((x) => x.id === c.id);
  for (const c2 of plan.list.slice(mine + 1)) {
    for (const y of plan.inv.get(c2.id)?.byId.values() || []) {
      const w = plan.verdict(c2, y.id, y.title);
      if (w && w.by.server === c.id && w.by.id === raw) out.hides.push({ id: pid(c2, y.id), server: c2.id, serverLabel: c2.label, title: y.title, reason: w.reason });
    }
  }
  return out;
}

const share = (changes) => ({
  /** Défait la décision (une nouvelle révision, pas un retour en arrière du document). */
  undo: () => { const r = matching.restore(matchDoc, changes, matchCtx()); if (r.ok) setMatchDoc(r.doc); },
});

/**
 * « Ces deux séries sont la même ». `shown` et `other` : { id (préfixé), title }. Refus : { ok: false, reason, with }
 * avec reason 'same-server' (le groupe aurait deux séries d'un même serveur ; `with` donne celles qui occupent déjà la
 * place), 'differs' (une décision dit le contraire), 'full' ou 'invalid'. Sinon { ok: true, visible, undo } : `visible`
 * est la série qui reste affichée (la première si elle n'est pas masquée).
 */
export async function groupWith(shown, other) {
  const a = refOf(shown), b = refOf(other);
  const r = matching.decide(matchDoc, matching.KIND.SAME, a, b, matchCtx());
  if (!r.ok) return { ok: false, reason: r.reason, with: (r.with || []).map((m) => ({ id: prefixed(m.s, m.i), server: m.s, serverLabel: connector(m.s)?.label || m.s, title: m.t })) };
  setMatchDoc(r.doc);
  const plan = await shadows({ all: true }).catch(() => NO_HIDE);
  const c = find(shown.id);
  const v = plan.verdict(c, a.i, shown.title);
  return { ok: true, visible: v ? place(v.by) : { id: shown.id, server: c.id, serverLabel: c.label, title: shown.title }, ...share(r.changes) };
}

/**
 * « Ce n'est pas la même série », depuis la série affichée `shown` pour la copie `copy` qu'elle masque. Une copie
 * liée à la main sort de son groupe ; si le titre suffit encore à la masquer, la paire est déclarée différente.
 * Renvoie { ok: true, undo }.
 */
export async function separate(shown, copy) {
  const b = refOf(copy);
  const ctx = matchCtx();
  let doc = matchDoc;
  const lists = [];
  if (matching.groupOf(doc, b)) { const r = matching.detach(doc, b, ctx); doc = r.doc; lists.push(r.changes); }
  // Tant que la copie reste masquée par le titre, on déclare la paire différente (au plus quelques séries de même titre).
  for (let i = 0; i < 5; i++) {
    const v = (await shadows({ all: true, doc })).verdict(find(copy.id), b.i, copy.title);
    if (!v) break;
    const r = matching.decide(doc, matching.KIND.DIFF, b, matching.ref(v.by.server, v.by.id, v.by.title), ctx);
    if (!r.ok) break;
    doc = r.doc; lists.push(r.changes);
  }
  const changes = matching.combine(...lists);
  if (!changes.length) return { ok: true, undo: () => {} };
  setMatchDoc(doc);
  return { ok: true, ...share(changes) };
}

/** Retire une décision (réglages). */
export function removeMatch(key) {
  const r = matching.remove(matchDoc, key, matchCtx());
  if (r.changes.length) setMatchDoc(r.doc);
  return share(r.changes);
}

/**
 * Décisions actives, pour les réglages : serveur, titre à la date de la décision, et `state` de chaque côté :
 * 'ok', 'missing' (la série n'existe plus chez ce serveur : dossier renommé, série supprimée) ou 'unknown'
 * (serveur désactivé, injoignable : on ne peut pas savoir). `ineffective` : décision sans effet (voir groups().skipped).
 */
export async function manualMatches() {
  const { skipped } = matching.groups(matchDoc);
  const list = active();
  const invs = new Map();
  await Promise.all(list.map(async (c) => { try { invs.set(c.id, await inventory(c)); } catch { /* inconnu */ } }));
  const side = (r) => {
    const inv = invs.get(r.s);
    return { server: r.s, serverLabel: connector(r.s)?.label || r.s, id: r.i, title: inv?.byId.get(r.i)?.title || r.t, state: !inv ? 'unknown' : inv.byId.has(r.i) ? 'ok' : 'missing' };
  };
  return matching.entries(matchDoc).map((x) => ({ key: x.key, kind: x.kind, at: x.at, a: side(x.a), b: side(x.b), ineffective: skipped.has(x.key) }))
    .sort((x, y) => y.at - x.at || (x.key < y.key ? -1 : 1));
}

/**
 * Séries d'autres serveurs que celui de `shown`, pour choisir celle qui est la même : { id, server, serverLabel, title }.
 * Écarte les séries déjà dans son groupe. Interroge seulement les serveurs de bibliothèque, à la demande de l'écran.
 */
export async function matchCandidates(shown, query) {
  const me = find(shown.id);
  const group = new Set((matching.groupOf(matchDoc, refOf(shown)) || []).map(matching.refKey));
  const others = active().filter((c) => c.id !== me.id);
  const results = await Promise.allSettled(others.map(async (c) => (await c.seriesList({ search: query, page: 0, size: 30 })).content.map((s) => ({ c, s }))));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter(({ c, s }) => !group.has(matching.refKey({ s: c.id, i: String(s.id) })))
    .map(({ c, s }) => ({ id: pid(c, s.id), server: c.id, serverLabel: c.label, title: titleOf(s) }));
}
