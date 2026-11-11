// Client GraphQL de Suwayomi-Server : authentification, renouvellement du
// jeton et envoi des requêtes. Le lecteur (readers/suwayomi.js) et le
// collecteur (collectors/suwayomi.js) parlent au même serveur : ils partagent
// ce client, donc la même session.
import { send, cached, unauthorized, AuthError, ApiError } from '../net.js';
import { Q } from './suwayomi-queries.js';

export const TOKEN_COOKIE = 'suwayomi-server-token';   // lu directement par Suwayomi (mode « UI login »)
export const BASIC_COOKIE = 'scrollarr_suwa_basic';    // converti en en-tête Authorization par le proxy
export const REFRESH_KEY = 'scrollarr.suwayomi.refresh';
const ID = 'suwayomi';

const clients = new Map();
/** Un seul client par adresse de serveur. */
export function suwayomiClient(base) {
  if (!clients.has(base)) clients.set(base, create(base));
  return clients.get(base);
}

function create(base) {
  const appPath = new URL('.', location.href).pathname;

  // ── Authentification ──
  function setCookie(name, value) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = value === null
      ? `${name}=; Path=${appPath}; Max-Age=0; SameSite=Strict${secure}`
      : `${name}=${value}; Path=${appPath}; Max-Age=31536000; SameSite=Strict${secure}`;
  }
  function clearAuth() {
    setCookie(TOKEN_COOKIE, null);
    setCookie(BASIC_COOKIE, null);
    localStorage.removeItem(REFRESH_KEY);
    clearTimeout(refreshTimer);
  }

  let refreshTimer = 0;
  /** Renouvelle le jeton un peu avant son expiration, pour que les images continuent de se charger. */
  function scheduleRefresh(token) {
    clearTimeout(refreshTimer);
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const wait = exp * 1000 - Date.now() - 30000;
      refreshTimer = setTimeout(() => refresh().catch(() => {}), Math.min(Math.max(wait, 5000), 2 ** 31 - 1));
    } catch { /* jeton illisible : le renouvellement se fera à la première erreur */ }
  }
  let refreshing = null;
  function refresh() {
    refreshing ??= (async () => {
      const token = localStorage.getItem(REFRESH_KEY);
      if (!token) throw new AuthError('Non connecté');
      // Un jeton expiré envoyé en cookie pourrait faire rejeter la demande de renouvellement elle-même.
      setCookie(TOKEN_COOKIE, null);
      const data = await raw('Refresh', { token });
      setCookie(TOKEN_COOKIE, data.refreshToken.accessToken);
      scheduleRefresh(data.refreshToken.accessToken);
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /** Une requête GraphQL, sans reprise automatique. Lève AuthError si la session est refusée. */
  async function raw(op, variables, { timeout, keepalive, probe } = {}) {
    const res = await send(ID, base + '/api/graphql', {
      method: 'POST', body: { operationName: op, query: Q[op], variables }, timeout, keepalive, probe,
    });
    if (res.status === 401) { const e = new AuthError('Non connecté'); e.http = true; throw e; }
    if (!res.ok) throw new ApiError(res.status);
    const json = await res.json();
    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join(' ; ');
      if (/unauthori[sz]ed/i.test(message)) throw new AuthError('Non connecté');
      throw new ApiError(400, message);
    }
    return json.data;
  }

  /** Requête avec renouvellement du jeton si nécessaire. */
  async function gql(op, variables, opts = {}) {
    try {
      return await raw(op, variables, opts);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      if (localStorage.getItem(REFRESH_KEY)) {
        try { await refresh(); return await raw(op, variables, opts); } catch (e2) { if (!(e2 instanceof AuthError)) throw e2; }
      }
      throw opts.quiet ? e : unauthorized(ID);
    }
  }
  const read = (op, variables) => cached(`${ID} ${op} ${JSON.stringify(variables || {})}`, () => gql(op, variables));

  // Le collecteur modifie ce que le lecteur a en mémoire (chapitres téléchargés) : il le lui signale.
  const listeners = new Set();
  const onChange = (fn) => listeners.add(fn);
  const changed = () => listeners.forEach((fn) => fn());

  return { ID, raw, gql, read, setCookie, clearAuth, scheduleRefresh, onChange, changed };
}
