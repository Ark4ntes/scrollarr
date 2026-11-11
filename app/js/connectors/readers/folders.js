// Lecteur « Dossiers » : le service scrollarr-folders (dossiers d'images et
// archives CBZ/ZIP montés en lecture seule, READ-002). Ses objets suivent le
// modèle commun de l'application (celui de Komga).
//
// Ce que ce lecteur ne fait pas, volontairement (voir l'étude, §4.5) :
//  - pas de `settings.store` : profils et abonnements restent chez les autres
//    serveurs, ou sur l'appareil quand il n'y en a pas ;
//  - la progression est enregistrée par le service, et par profil (`chapter.progress.profiles`) :
//    la façade indique le profil actif, que ce lecteur joint à chaque requête (`?profile=`) ;
//  - pas de genres, de nouveautés, de « à suivre » : les listes correspondantes sont vides.
import { send, cached, unauthorized, qs, AuthError, ApiError } from '../../net.js';
import { idb } from '../../idb.js';
import { t } from '../../i18n.js';
import { CAP } from '../contract.js';

const SORTS = { title: 'metadata.titleSort,asc', updated: 'lastModified,desc', added: 'created,desc' };

export function createFolders({ base }) {
  const ID = 'folders';
  let profile = null; // profil actif ; null = principal (pas de paramètre, le service prend `main`)
  let auth = null; // « password » ou « none », appris à la dernière vérification de session

  async function request(path, opts = {}) {
    // Le service exige Content-Type: application/json sur toute requête autre que GET,
    // or net.js ne l'envoie que s'il y a un corps : une requête sans corps en reçoit un vide.
    const method = opts.method || 'GET';
    const body = method !== 'GET' && opts.body === undefined ? {} : opts.body;
    const res = await send(ID, base + path, { ...opts, body });
    if (res.status === 401) throw opts.quiet ? new AuthError('Non connecté') : unauthorized(ID);
    if (!res.ok) throw new ApiError(res.status);
    if (res.status === 204) return null;
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : null;
  }
  const read = (path, opts = {}) => cached(`${ID} ${opts.method || 'GET'} ${path}`, () => request(path, opts));

  async function sibling(id, dir) {
    try { return await read(`/api/v1/books/${id}/${dir}` + qs({ profile })); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }

  const pageUrl = (bookId, n) => `${base}/api/v1/books/${bookId}/pages/${n}`;
  // Un chapitre n'a pas de couverture propre : c'est celle de sa série, déduite de son identifiant (« <série>.<chapitre> »).
  const seriesOf = (bookId) => String(bookId).split('.', 1)[0];

  return {
    id: ID,
    code: 'f',
    label: t('Dossiers'),
    userLabel: 'Identifiant',
    capabilities: [CAP.SERIES_LIST, CAP.SERIES_SEARCH, CAP.CHAPTER_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_READ, CAP.PROGRESS_WRITE, CAP.PROGRESS_PROFILES],

    // ── Session ──
    // Mode « none » : aucune connexion à faire, le nom d'utilisateur reste vide
    // (l'écran n'affiche alors ni « Connecté en tant que » ni bouton de déconnexion).
    async session() {
      try {
        const u = await request('/api/v1/session', { quiet: true, probe: true });
        auth = u.auth;
        const me = { name: u.user || null, auth: u.auth };
        await idb.set('kv', 'me:' + ID, me);
        return { name: me.name };
      } catch (e) {
        if (e instanceof AuthError || e instanceof ApiError) throw e;
        const u = await idb.get('kv', 'me:' + ID);
        if (u) { auth = u.auth; return { name: u.name, offline: true }; }
        throw e;
      }
    },
    async login(user, password) {
      if (auth === 'none') throw new ApiError(400, 'authentification désactivée');
      const u = await request('/api/v1/login', { method: 'POST', quiet: true, body: { username: user, password } });
      const me = { name: u.user, auth: 'password' };
      auth = 'password';
      await idb.set('kv', 'me:' + ID, me);
      return { name: me.name };
    },
    async logout() {
      if (auth === 'none') return;
      try { await request('/api/v1/logout', { method: 'POST', quiet: true }); } catch { /* la session expirera d'elle-même */ }
      await idb.del('kv', 'me:' + ID);
    },

    // ── Bibliothèque ──
    // Le service renvoie toutes les bibliothèques ; avec une seule, l'écran n'a pas de filtre à proposer.
    async libraries() {
      const all = await read('/api/v1/libraries');
      return all.length > 1 ? all : [];
    },
    genres: async () => [],

    seriesList({ libraryId, readStatus, search, sort = 'title', page = 0, size = 30 } = {}) {
      return read('/api/v1/series' + qs({ library: libraryId, status: readStatus, search, sort: SORTS[sort], page, size, profile }));
    },
    seriesNew: async () => ({ content: [] }),
    // Séries dont le dossier a été modifié le plus récemment : de quoi remplir l'accueil sans rien mémoriser.
    seriesUpdated: (size) => read('/api/v1/series' + qs({ sort: SORTS.updated, size, profile })),
    series: (id) => read(`/api/v1/series/${id}` + qs({ profile })),
    async seriesBooks(seriesId) {
      return (await read(`/api/v1/series/${seriesId}/books` + qs({ profile }))).content;
    },

    booksLatest: async () => ({ content: [] }),
    booksOnDeck: async () => ({ content: [] }),
    booksInProgress: (size) => read('/api/v1/books/inprogress' + qs({ size, profile })),
    booksRecentlyRead: (size) => read('/api/v1/books/recent' + qs({ size, profile })),

    book: (id) => read(`/api/v1/books/${id}` + qs({ profile })),
    async bookPages(id) {
      const pages = await read(`/api/v1/books/${id}/pages`);
      // Pas de dimensions (la hauteur s'ajuste à l'arrivée de l'image) ni de repli : les images sont servies telles quelles.
      return pages.map((p) => ({ number: p.number, mediaType: p.mediaType, url: pageUrl(id, p.number) }));
    },
    nextBook: (id) => sibling(id, 'next'),
    previousBook: (id) => sibling(id, 'previous'),

    // ── Images ──
    seriesThumb: (id) => `${base}/api/v1/series/${id}/thumbnail`,
    bookThumb: (id) => `${base}/api/v1/series/${seriesOf(id)}/thumbnail`,

    // ── Progression ──
    // Sans corps pour les routes qui n'en ont pas : request() en envoie un vide (Content-Type exigé par le service).
    saveProgress: (bookId, page, completed, { keepalive } = {}) =>
      request(`/api/v1/books/${bookId}/progress` + qs({ profile }), { method: 'PATCH', body: { page, completed }, keepalive }),
    markBookRead: (id) => request(`/api/v1/books/${id}/progress` + qs({ profile }), { method: 'PATCH', body: { completed: true } }),
    markBookUnread: (id) => request(`/api/v1/books/${id}/progress` + qs({ profile }), { method: 'DELETE' }),
    markSeriesRead: (id) => request(`/api/v1/series/${id}/progress` + qs({ profile }), { method: 'PUT' }),
    markSeriesUnread: (id) => request(`/api/v1/series/${id}/progress` + qs({ profile }), { method: 'DELETE' }),

    // ── Profils (chapter.progress.profiles) ──
    // Le profil principal n'envoie rien : le service range sous `main` ce qui n'a pas de profil.
    setProfile(id) { profile = !id || id === 'main' ? null : id; },
    forgetProfile: (id) => request(`/api/v1/profiles/${encodeURIComponent(id)}/progress`, { method: 'DELETE' }),
  };
}
