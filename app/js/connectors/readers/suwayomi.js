// Lecteur Suwayomi-Server (https://github.com/Suwayomi/Suwayomi-Server) — API GraphQL.
// Traduit les mangas et chapitres de Suwayomi vers le modèle commun de
// l'application (celui de Komga : séries, livres, progression).
import { cached, memo, normTitle, AuthError, OfflineError } from '../../net.js';
import { idb } from '../../idb.js';
import { CAP } from '../contract.js';
import { suwayomiClient, TOKEN_COOKIE, BASIC_COOKIE, REFRESH_KEY } from '../suwayomi-client.js';

const STATUS = { ONGOING: 'ONGOING', COMPLETED: 'ENDED', PUBLISHING_FINISHED: 'ENDED', CANCELLED: 'ABANDONED', ON_HIATUS: 'HIATUS' };
const USER_KEY = 'scrollarr.suwayomi.user';

const num = (v) => Number(v) || 0;
const isoSec = (v) => (num(v) > 0 ? new Date(num(v) * 1000).toISOString() : null);
const desc = (get) => (a, b) => (get(b) || '').localeCompare(get(a) || '');

export function createSuwayomi({ base }) {
  const ID = 'suwayomi';

  const client = suwayomiClient(base);
  const { raw, gql, read, setCookie, clearAuth, scheduleRefresh } = client;

  // ── Traduction vers le modèle commun ──
  const parts = (bookId) => { const [mangaId, chapterId] = String(bookId).split('.'); return { mangaId: Number(mangaId), chapterId: Number(chapterId) }; };

  function toBook(ch, title) {
    const pages = Math.max(0, ch.pageCount || 0);
    // Pour Suwayomi, un chapitre simplement ouvert (ou remis à « non lu ») garde une date de
    // lecture mais reste à la page 0 : on ne le compte pas comme commencé.
    const started = ch.isRead || ch.lastPageRead > 0;
    const number = ch.chapterNumber >= 0 ? ch.chapterNumber : ch.sourceOrder;
    const fetched = isoSec(ch.fetchedAt);
    return {
      id: `${ch.mangaId}.${ch.id}`,
      seriesId: String(ch.mangaId),
      seriesTitle: title,
      name: ch.name,
      number,
      created: fetched,
      lastModified: fetched,
      media: { pagesCount: pages },
      metadata: {
        title: ch.name, number: String(number), numberSort: number,
        releaseDate: num(ch.uploadDate) > 0 ? new Date(num(ch.uploadDate)).toISOString().slice(0, 10) : null,
      },
      readProgress: started ? {
        page: ch.isRead ? (pages || ch.lastPageRead + 1) : ch.lastPageRead + 1,
        completed: ch.isRead,
        readDate: isoSec(ch.lastReadAt),
      } : undefined,
      onServer: ch.isDownloaded,
      order: ch.sourceOrder,
    };
  }

  function toSeries(m) {
    const total = m.chapters?.totalCount || 0;
    const unread = Math.min(total, m.unreadCount || 0);
    // Suwayomi renvoie toujours un « dernier chapitre lu », même pour une série jamais ouverte.
    const last = num(m.lastReadChapter?.lastReadAt) > 0 ? m.lastReadChapter : null;
    const inProgress = last && !last.isRead && last.lastPageRead > 0 ? 1 : 0;
    const added = isoSec(m.inLibraryAt);
    const authors = [];
    if (m.author) authors.push({ name: m.author, role: 'writer' });
    if (m.artist && m.artist !== m.author) authors.push({ name: m.artist, role: 'penciller' });
    return {
      id: String(m.id),
      name: m.title,
      created: added,
      lastModified: isoSec(m.latestFetchedChapter?.fetchedAt) || added,
      booksCount: total,
      booksReadCount: total - unread,
      booksInProgressCount: inProgress,
      booksUnreadCount: Math.max(0, unread - inProgress),
      metadata: { title: m.title, status: STATUS[m.status] || null, summary: m.description || '', genres: m.genre || [] },
      booksMetadata: { authors },
      categoryIds: (m.categories?.nodes || []).map((c) => String(c.id)),
      started: total > unread || inProgress > 0,
    };
  }
  const readStatus = (s) => (s.booksCount > 0 && s.booksReadCount === s.booksCount ? 'READ' : s.started ? 'IN_PROGRESS' : 'UNREAD');

  // La bibliothèque entière est demandée en une fois puis filtrée ici : Suwayomi
  // n'offre ni tri par dernière mise à jour ni filtre par état de lecture.
  const short = memo(10000);
  const rawLibrary = () => short('library', async () => (await read('Library')).mangas.nodes);
  const library = async () => (await rawLibrary()).map(toSeries);
  const chapters = (mangaId) => short('chapters ' + mangaId, async () => (await read('Chapters', { mangaId })).chapters.nodes);
  async function titleOf(mangaId) {
    const hit = (await rawLibrary().catch(() => [])).find((m) => m.id === mangaId);
    return hit ? hit.title : (await read('Manga', { id: mangaId })).manga.title;
  }
  const bookList = (nodes) => ({ content: nodes.map((c) => toBook(c, c.manga.title)) });
  const changed = () => short.clear();
  client.onChange(changed);

  async function sibling(bookId, dir) {
    const { mangaId, chapterId } = parts(bookId);
    const list = await chapters(mangaId);
    const i = list.findIndex((c) => c.id === chapterId);
    const other = i < 0 ? null : list[i + dir];
    return other ? toBook(other, await titleOf(mangaId)) : null;
  }

  return {
    id: ID,
    code: 's',
    label: 'Suwayomi',
    userLabel: 'Identifiant',
    capabilities: [
      CAP.SERIES_LIST, CAP.SERIES_SEARCH, CAP.CHAPTER_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_READ, CAP.PROGRESS_WRITE,
      CAP.SETTINGS_STORE,
    ],

    // ── Session ──
    async session() {
      try {
        await gql('Probe', undefined, { quiet: true, probe: true });
        await idb.set('kv', 'me:' + ID, true);
        return { name: localStorage.getItem(USER_KEY) || null };
      } catch (e) {
        if (e instanceof OfflineError && (await idb.get('kv', 'me:' + ID))) return { name: localStorage.getItem(USER_KEY) || null, offline: true };
        throw e;
      }
    },

    /**
     * Suwayomi connaît quatre modes : sans authentification, « basic auth »,
     * « simple login » et « UI login ». On les essaie dans l'ordre plutôt que
     * de demander à l'utilisateur lequel est configuré.
     */
    async login(user, password) {
      clearAuth();
      const probe = async () => {
        try { await raw('Probe'); return 'ok'; }
        catch (e) { if (e instanceof AuthError) return e.http ? 'http' : 'gql'; throw e; }
      };
      const bytes = new TextEncoder().encode(`${user}:${password}`);
      const basic = btoa(String.fromCharCode(...bytes));
      let state = await probe();
      if (state === 'gql') {
        // « UI login » : jeton JWT, que Suwayomi accepte aussi sous forme de cookie.
        try {
          const { login } = await raw('Login', { username: user, password });
          setCookie(TOKEN_COOKIE, login.accessToken);
          if ((await probe()) === 'ok') {
            localStorage.setItem(REFRESH_KEY, login.refreshToken);
            scheduleRefresh(login.accessToken);
            state = 'ok';
          } else setCookie(TOKEN_COOKIE, null);
        } catch (e) { if (e instanceof OfflineError) throw e; }
      }
      if (state !== 'ok') {
        // « Basic auth » et « simple login » acceptent tous deux l'en-tête Basic.
        setCookie(BASIC_COOKIE, basic);
        state = await probe();
      }
      if (state !== 'ok') { clearAuth(); throw new AuthError('Identifiants refusés'); }
      localStorage.setItem(USER_KEY, user);
      await idb.set('kv', 'me:' + ID, true);
      return { name: user };
    },
    async logout() {
      clearAuth();
      localStorage.removeItem(USER_KEY);
      await idb.del('kv', 'me:' + ID);
    },

    // ── Bibliothèque ──
    async libraries() {
      const [cats, lib] = await Promise.all([read('Categories'), library()]);
      const used = new Set(lib.flatMap((s) => s.categoryIds));
      const list = cats.categories.nodes.filter((c) => used.has(String(c.id))).sort((a, b) => a.order - b.order);
      // Une seule catégorie : inutile de proposer un filtre.
      return list.length > 1 ? list.map((c) => ({ id: String(c.id), name: c.name })) : [];
    },
    async genres() {
      return [...new Set((await library()).flatMap((s) => s.metadata.genres))].sort((a, b) => a.localeCompare(b));
    },

    async seriesList({ libraryId, genre, readStatus: status, search, sort = 'title', page = 0, size = 30 } = {}) {
      let list = await library();
      if (libraryId) list = list.filter((s) => s.categoryIds.includes(String(libraryId)));
      if (genre) list = list.filter((s) => s.metadata.genres.includes(genre));
      if (status) list = list.filter((s) => readStatus(s) === status);
      if (search) { const needle = normTitle(search); list = list.filter((s) => normTitle(s.name).includes(needle)); }
      if (sort === 'updated') list.sort(desc((s) => s.lastModified));
      else if (sort === 'added') list.sort(desc((s) => s.created));
      else list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      const content = list.slice(page * size, page * size + size);
      return { content, last: (page + 1) * size >= list.length };
    },
    async seriesNew(size) { return { content: (await library()).sort(desc((s) => s.created)).slice(0, size) }; },
    async seriesUpdated(size) { return { content: (await library()).sort(desc((s) => s.lastModified)).slice(0, size) }; },
    async series(id) {
      const hit = (await rawLibrary().catch(() => [])).find((m) => m.id === Number(id));
      return toSeries(hit || (await read('Manga', { id: Number(id) })).manga);
    },
    async seriesBooks(id) {
      const [list, title] = await Promise.all([chapters(Number(id)), titleOf(Number(id))]);
      return list.map((c) => toBook(c, title));
    },

    async booksLatest(size) { return bookList((await read('Latest', { first: size })).chapters.nodes); },
    async booksInProgress(size) { return bookList((await read('InProgress', { first: size })).chapters.nodes); },
    async booksRecentlyRead(size) {
      // On demande large : les chapitres seulement ouverts sont écartés ensuite.
      const nodes = (await read('RecentlyRead', { first: size * 2 })).chapters.nodes;
      return bookList(nodes.filter((c) => c.isRead || c.lastPageRead > 0).slice(0, size));
    },
    /**
     * La suite des séries entamées : le chapitre qui suit le plus avancé des
     * chapitres lus, s'il n'est pas commencé. Beaucoup de lecteurs reprennent
     * une série en cours de route, sans marquer les premiers chapitres comme
     * lus : on ne propose donc pas « le premier chapitre non lu ».
     */
    async booksOnDeck(size) {
      const candidates = (await rawLibrary())
        .filter((m) => (m.chapters?.totalCount || 0) > (m.unreadCount || 0) && num(m.lastReadChapter?.lastReadAt) > 0)
        .sort((a, b) => num(b.lastReadChapter.lastReadAt) - num(a.lastReadChapter.lastReadAt))
        .slice(0, Math.min(size, 12));
      const next = await Promise.all(candidates.map(async (m) => {
        const list = await chapters(m.id).catch(() => []);
        const ch = list[list.findLastIndex((c) => c.isRead) + 1];
        return ch && !ch.isRead && ch.lastPageRead === 0 && list.some((c) => c.isRead) ? toBook(ch, m.title) : null;
      }));
      return { content: next.filter(Boolean) };
    },

    async book(id) {
      const { chapter } = await read('Chapter', { id: parts(id).chapterId });
      return toBook(chapter, chapter.manga.title);
    },
    /**
     * Prépare les pages du chapitre. S'il n'est pas téléchargé sur le serveur,
     * Suwayomi va les chercher chez la source : cela peut prendre du temps.
     */
    async bookPages(id) {
      const { chapterId } = parts(id);
      const data = await cached(`${ID} Pages ${chapterId}`, () => gql('Pages', { id: chapterId }, { timeout: 90000 }));
      return data.fetchChapterPages.pages.map((path, i) => ({ number: i + 1, mediaType: 'image/*', url: base + path }));
    },
    nextBook: (id) => sibling(id, +1),
    previousBook: (id) => sibling(id, -1),

    // ── Images ──
    seriesThumb: (id) => `${base}/api/v1/manga/${id}/thumbnail`,
    // Les chapitres n'ont pas de vignette propre : on reprend la couverture du manga.
    bookThumb: (id) => `${base}/api/v1/manga/${parts(id).mangaId}/thumbnail`,

    // ── Progression ──
    async saveProgress(bookId, page, completed, { keepalive } = {}) {
      await gql('Progress', { id: parts(bookId).chapterId, isRead: !!completed, lastPageRead: Math.max(0, page - 1) }, { keepalive });
      changed();
    },
    async markBookRead(id) { await gql('Progress', { id: parts(id).chapterId, isRead: true }); changed(); },
    async markBookUnread(id) { await gql('Progress', { id: parts(id).chapterId, isRead: false, lastPageRead: 0 }); changed(); },
    async markSeriesRead(id) {
      await gql('ProgressMany', { ids: (await chapters(Number(id))).map((c) => c.id), isRead: true });
      changed();
    },
    async markSeriesUnread(id) {
      await gql('ProgressMany', { ids: (await chapters(Number(id))).map((c) => c.id), isRead: false, lastPageRead: 0 });
      changed();
    },

    // ── Réglages stockés côté serveur ──
    // Suwayomi limite chaque valeur à 4096 caractères : la façade découpe les valeurs longues.
    async getSettings(prefix) {
      return Object.fromEntries((await gql('Metas', { prefix })).metas.nodes.map((m) => [m.key, m.value]));
    },
    setSetting: (key, value) => gql('SetMeta', { key, value }),
    async deleteSettings(keys) { for (const key of keys) await gql('DeleteMeta', { key }); },
  };
}
