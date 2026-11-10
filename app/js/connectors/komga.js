// Connecteur Komga (https://komga.org) — API REST.
// Les objets de Komga (séries, livres) servent de modèle commun à
// l'application : ce connecteur les renvoie donc presque tels quels.
import { send, cached, unauthorized, qs, AuthError, ApiError } from '../net.js';
import { idb } from '../idb.js';
import { CAP } from './contract.js';

const SORTS = { title: 'metadata.titleSort,asc', updated: 'lastModified,desc', added: 'created,desc' };
const is = (value) => ({ operator: 'is', value });
const allOf = (conds) => (conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : { allOf: conds });

export function createKomga({ base }) {
  const ID = 'komga';

  async function request(path, opts = {}) {
    const res = await send(ID, base + path, opts);
    if (res.status === 401) throw opts.quiet ? new AuthError('Non connecté') : unauthorized(ID);
    if (!res.ok) throw new ApiError(res.status);
    if (res.status === 204) return null;
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : null;
  }
  const read = (path, opts = {}) =>
    cached(`${ID} ${opts.method || 'GET'} ${path}${opts.body ? ' ' + JSON.stringify(opts.body) : ''}`, () => request(path, opts));

  async function sibling(id, dir) {
    try { return await read(`/api/v1/books/${id}/${dir}`); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }

  const pageUrl = (bookId, n, convert) => `${base}/api/v1/books/${bookId}/pages/${n}` + (convert ? `?convert=${convert}` : '');

  return {
    id: ID,
    code: 'k',
    label: 'Komga',
    userLabel: 'Adresse e-mail',
    capabilities: [CAP.SERIES_LIST, CAP.SERIES_SEARCH, CAP.CHAPTER_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_READ, CAP.PROGRESS_WRITE, CAP.SETTINGS_STORE],

    // ── Session ──
    async session() {
      try {
        const u = await request('/api/v2/users/me', { quiet: true });
        await idb.set('kv', 'me:' + ID, u);
        return { name: u.email };
      } catch (e) {
        if (e instanceof AuthError || e instanceof ApiError) throw e;
        const u = await idb.get('kv', 'me:' + ID);
        if (u) return { name: u.email, offline: true };
        throw e;
      }
    },
    async login(user, password) {
      const bytes = new TextEncoder().encode(`${user}:${password}`);
      const u = await request('/api/v2/users/me' + qs({ 'remember-me': 'true' }), {
        quiet: true, headers: { Authorization: 'Basic ' + btoa(String.fromCharCode(...bytes)) },
      });
      await idb.set('kv', 'me:' + ID, u);
      return { name: u.email };
    },
    async logout() {
      try { await request('/api/logout', { method: 'POST', quiet: true }); } catch { /* la session expirera d'elle-même */ }
      await idb.del('kv', 'me:' + ID);
    },

    // ── Bibliothèque ──
    libraries: () => read('/api/v1/libraries'),
    genres: () => read('/api/v1/genres'),

    seriesList({ libraryId, genre, readStatus, search, sort = 'title', page = 0, size = 30 } = {}) {
      const conds = [];
      if (libraryId) conds.push({ libraryId: is(libraryId) });
      if (genre) conds.push({ genre: is(genre) });
      if (readStatus) conds.push({ readStatus: is(readStatus) });
      const body = {};
      const condition = allOf(conds);
      if (condition) body.condition = condition;
      if (search) body.fullTextSearch = search;
      // Avec une recherche plein texte, on garde le tri par pertinence du serveur.
      return read('/api/v1/series/list' + qs({ page, size, sort: search ? undefined : SORTS[sort] }), { method: 'POST', body });
    },
    seriesNew: (size) => read('/api/v1/series/new' + qs({ size })),
    seriesUpdated: (size) => read('/api/v1/series/updated' + qs({ size })),
    series: (id) => read(`/api/v1/series/${id}`),

    async seriesBooks(seriesId) {
      const out = [];
      for (let page = 0; page < 40; page++) {
        const res = await read('/api/v1/books/list' + qs({ page, size: 500, sort: 'metadata.numberSort,asc' }), {
          method: 'POST', body: { condition: { seriesId: is(seriesId) } },
        });
        out.push(...res.content);
        if (res.last || res.content.length === 0) break;
      }
      return out;
    },

    booksLatest: (size) => read('/api/v1/books/latest' + qs({ size })),
    booksOnDeck: (size) => read('/api/v1/books/ondeck' + qs({ size })),
    booksInProgress: (size) => read('/api/v1/books/list' + qs({ size, sort: 'readProgress.readDate,desc' }), {
      method: 'POST', body: { condition: { readStatus: is('IN_PROGRESS') } },
    }),
    booksRecentlyRead: (size) => read('/api/v1/books/list' + qs({ size, sort: 'readProgress.readDate,desc' }), {
      method: 'POST', body: { condition: { anyOf: [{ readStatus: is('IN_PROGRESS') }, { readStatus: is('READ') }] } },
    }),

    book: (id) => read(`/api/v1/books/${id}`),
    async bookPages(id) {
      const pages = await read(`/api/v1/books/${id}/pages`);
      return pages.map((p) => ({
        number: p.number, mediaType: p.mediaType, width: p.width, height: p.height,
        url: pageUrl(id, p.number),
        // Format que le navigateur ne sait pas afficher : Komga peut convertir à la volée.
        fallbackUrl: pageUrl(id, p.number, 'jpeg'),
      }));
    },
    nextBook: (id) => sibling(id, 'next'),
    previousBook: (id) => sibling(id, 'previous'),

    // ── Images ──
    seriesThumb: (id) => `${base}/api/v1/series/${id}/thumbnail`,
    bookThumb: (id) => `${base}/api/v1/books/${id}/thumbnail`,

    // ── Progression ──
    saveProgress: (bookId, page, completed, { keepalive } = {}) =>
      request(`/api/v1/books/${bookId}/read-progress`, { method: 'PATCH', body: { page, completed }, keepalive }),
    markBookRead: (id) => request(`/api/v1/books/${id}/read-progress`, { method: 'PATCH', body: { completed: true } }),
    markBookUnread: (id) => request(`/api/v1/books/${id}/read-progress`, { method: 'DELETE' }),
    markSeriesRead: (id) => request(`/api/v1/series/${id}/read-progress`, { method: 'POST' }),
    markSeriesUnread: (id) => request(`/api/v1/series/${id}/read-progress`, { method: 'DELETE' }),

    // ── Réglages stockés côté serveur (par utilisateur) ──
    // Les clés doivent être en minuscules, segments séparés par des points.
    async getSettings(prefix) {
      const all = (await request('/api/v1/client-settings/user/list')) || {};
      return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, v.value]));
    },
    deleteSettings: (keys) => request('/api/v1/client-settings/user', { method: 'DELETE', body: keys }),
    setSetting: (key, value) => request('/api/v1/client-settings/user', { method: 'PATCH', body: { [key]: { value } } }),
  };
}
