// Couche réseau commune à tous les connecteurs : erreurs typées, état
// « joignable », cache de secours pour le hors-ligne.
import { idb } from './idb.js';

export class AuthError extends Error {}
export class OfflineError extends Error {}
export class ApiError extends Error {
  constructor(status, message) { super(message || `HTTP ${status}`); this.status = status; }
}

/** Événements : « reachable » (detail: booléen), « unauthorized » (detail: id du serveur). */
export const events = new EventTarget();

const down = new Set(); // identifiants des serveurs injoignables
export const isReachable = () => down.size === 0;
export const isServerReachable = (serverId) => !down.has(serverId);
function setReachable(serverId, ok) {
  const before = isReachable();
  if (ok) down.delete(serverId); else down.add(serverId);
  if (before !== isReachable()) events.dispatchEvent(new CustomEvent('reachable', { detail: isReachable() }));
}
/** Un serveur désactivé ne doit plus compter comme « injoignable ». */
export const forgetServer = (serverId) => setReachable(serverId, true);

/**
 * Requête HTTP vers un serveur placé derrière le proxy de même origine.
 * Renvoie la réponse brute : chaque connecteur l'interprète à sa façon.
 */
export async function send(serverId, url, { method = 'GET', body, headers, timeout = 15000, keepalive } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      keepalive,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        // Évite la fenêtre d'authentification native du navigateur sur un 401.
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    setReachable(serverId, false);
    throw new OfflineError('Serveur injoignable');
  } finally {
    clearTimeout(timer);
  }
  // Le service worker ou le proxy répondent 502/503/504 quand le serveur est arrêté.
  if (res.status >= 502 && res.status <= 504) { setReachable(serverId, false); throw new OfflineError('Serveur injoignable'); }
  setReachable(serverId, true);
  return res;
}

export function unauthorized(serverId) {
  events.dispatchEvent(new CustomEvent('unauthorized', { detail: serverId }));
  return new AuthError('Non connecté');
}

/** Exécute `load` ; si le serveur est injoignable, renvoie la dernière réponse connue pour `key`. */
export async function cached(key, load) {
  try {
    const data = await load();
    idb.set('apicache', key, { t: Date.now(), data });
    return data;
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    const hit = await idb.get('apicache', key);
    if (hit) return hit.data;
    throw e;
  }
}

/** Mémoire courte : évite de redemander la même liste plusieurs fois pour un même écran. */
export function memo(ttl) {
  const map = new Map();
  const wrapped = (key, load) => {
    const hit = map.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = load();
    map.set(key, { t: Date.now(), p });
    p.catch(() => { if (map.get(key)?.p === p) map.delete(key); });
    return p;
  };
  wrapped.clear = () => map.clear();
  return wrapped;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.append(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

/** Titre ramené à une forme comparable (sans accents, casse ni ponctuation). */
export const normTitle = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
