// Imitation de Suwayomi-Server pour le serveur de démonstration (voir mock-servers.mjs).
// Répond aux opérations GraphQL envoyées par app/js/connectors/suwayomi.js et
// reproduit les quatre modes d'authentification de Suwayomi.
//
//   SUWA_AUTH=none|basic|simple|ui   mode d'authentification (défaut : none)
//   SUWA_TOKEN_TTL=300               durée de vie du jeton en mode « ui », en secondes
//   Identifiants : demo / demo
//   POST /suwayomi/__mock/add-chapter?manga=<id>   simule l'arrivée d'un chapitre

export function createSuwayomiMock({ rng, coverSvg, pageSvg, send, svg, readBody, cookie }) {
  const AUTH = process.env.SUWA_AUTH || 'none';
  const TTL = Number(process.env.SUWA_TOKEN_TTL || 300);
  const USER = 'demo';
  const PASSWORD = 'demo';
  const DAY = 86400;
  const now = () => Math.floor(Date.now() / 1000);

  // ───────────── Données ─────────────
  // Deux titres existent aussi dans la fausse bibliothèque Komga, pour exercer le masquage des doublons.
  const seed = [
    ['Les Veilleurs de Brume', 38, ['Fantastique', 'Aventure'], 'ONGOING', 'Aya Kurose', 268, false, [1]],
    ['Café Lune Rouge', 18, ['Romance', 'Tranche de vie'], 'ONGOING', 'Mio Hanazawa', 340, true, [1]],
    ['Le Jardin des Automates', 22, ['Science-fiction', 'Mystère'], 'ONGOING', 'Rin Kagawa', 160, true, [2]],
    ['Minuit à Kabukichō', 41, ['Thriller', 'Drame'], 'ON_HIATUS', 'Jun Sawada', 300, false, [1]],
    ['La Fille du Phare', 14, ['Tranche de vie', 'Drame'], 'COMPLETED', 'Sora Ibuki', 200, true, [2]],
    ['Dojo Tanuki', 57, ['Comédie', 'Action'], 'ONGOING', 'Kenta Ōmori', 40, false, [1, 2]],
    ['Neuf Vies', 9, ['Fantastique', 'Mystère'], 'ONGOING', 'Emi Tsukishiro', 120, true, [0]],
  ];
  const categories = [
    { id: 0, name: 'Default', order: 0 },
    { id: 1, name: 'Manga', order: 1 },
    { id: 2, name: 'Webtoons', order: 2 },
  ];
  const mangas = [];
  const chapters = [];
  const metas = new Map();
  let chapterId = 0;

  function addChapter(m, n, fetchedAt, downloaded) {
    const r = rng('suwa' + m.id + ':' + n);
    const pages = m.tall ? 6 + Math.floor(r() * 6) : 14 + Math.floor(r() * 12);
    const ch = {
      id: ++chapterId, mangaId: m.id, name: `Chapitre ${n}`, chapterNumber: n, sourceOrder: n, scanlator: null,
      isRead: false, isDownloaded: downloaded, lastPageRead: 0, lastReadAt: 0,
      // Comme sur un vrai serveur : le nombre de pages est inconnu tant que le chapitre n'a pas été ouvert ou téléchargé.
      pageCount: downloaded ? pages : -1,
      uploadDate: (fetchedAt - 3600) * 1000, fetchedAt,
      _pages: pages,
    };
    chapters.push(ch);
    return ch;
  }

  seed.forEach(([title, count, genre, status, author, hue, tall, cats], i) => {
    const m = {
      id: i + 1, title, author, artist: author, description: `${title} — série de démonstration servie par le faux Suwayomi.`,
      genre, status, inLibrary: true, inLibraryAt: now() - (120 - i * 9) * DAY, categoryIds: cats, tall,
      // Champs lus par les générateurs d'images partagés avec le faux Komga.
      _hue: hue, metadata: { title },
    };
    mangas.push(m);
    // Les deux tiers des chapitres sont déjà téléchargés sur le « serveur ».
    for (let n = 1; n <= count; n++) addChapter(m, n, now() - (count - n) * (2 + (i % 3)) * DAY - i * 1800, n <= Math.ceil(count * 0.66));
  });

  function markRead(mangaIdx, upTo, partial) {
    const list = chapters.filter((c) => c.mangaId === mangas[mangaIdx].id);
    list.slice(0, upTo).forEach((c, k) => { c.isRead = true; c.lastPageRead = Math.max(0, c.pageCount - 1); c.lastReadAt = now() - (upTo - k) * 3600 - mangaIdx * DAY; });
    if (partial) { const c = list[upTo]; c.lastPageRead = partial; c.lastReadAt = now() - mangaIdx * 4000 - 600; }
  }
  markRead(2, 9, 4); markRead(3, 12, 0); markRead(5, 30, 0); markRead(0, 21, 0);

  // ───────────── Sérialisation ─────────────
  const S = (n) => String(n); // le scalaire Long de Suwayomi voyage sous forme de chaîne
  const chapterDto = (c, withManga) => c && ({
    id: c.id, name: c.name, chapterNumber: c.chapterNumber, sourceOrder: c.sourceOrder, mangaId: c.mangaId, scanlator: c.scanlator,
    isRead: c.isRead, isDownloaded: c.isDownloaded, lastPageRead: c.lastPageRead, lastReadAt: S(c.lastReadAt), pageCount: c.pageCount,
    uploadDate: S(c.uploadDate), fetchedAt: S(c.fetchedAt),
    ...(withManga ? { manga: { id: c.mangaId, title: mangas.find((m) => m.id === c.mangaId).title } } : {}),
  });
  function mangaDto(m) {
    const list = chapters.filter((c) => c.mangaId === m.id).sort((a, b) => a.sourceOrder - b.sourceOrder);
    // Comme le vrai serveur : toujours un chapitre, même si aucun n'a été lu (sa date vaut alors 0).
    const read = [...list].sort((a, b) => b.lastReadAt - a.lastReadAt)[0];
    const latest = [...list].sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return {
      id: m.id, title: m.title, author: m.author, artist: m.artist, description: m.description, genre: m.genre, status: m.status,
      inLibrary: m.inLibrary, inLibraryAt: S(m.inLibraryAt),
      unreadCount: list.filter((c) => !c.isRead).length, downloadCount: list.filter((c) => c.isDownloaded).length,
      chapters: { totalCount: list.length },
      categories: { nodes: m.categoryIds.map((id) => ({ id })) },
      latestFetchedChapter: latest ? { fetchedAt: S(latest.fetchedAt) } : null,
      lastReadChapter: chapterDto(read) || null,
      firstUnreadChapter: chapterDto(list.find((c) => !c.isRead)) || null,
    };
  }
  const inLibrary = (c) => mangas.find((m) => m.id === c.mangaId).inLibrary;

  // ───────────── Authentification ─────────────
  const refreshTokens = new Set();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const makeToken = (ttl) => `h.${b64({ exp: now() + ttl })}.s`;
  function tokenValid(token) {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp > now(); } catch { return false; }
  }
  /** En production, c'est nginx qui transforme le cookie « basic » en en-tête Authorization. */
  function authorization(req) {
    const fromCookie = cookie(req, 'scrollarr_suwa_basic');
    return fromCookie ? 'Basic ' + decodeURIComponent(fromCookie) : req.headers.authorization || '';
  }
  const basicValid = (req) => authorization(req) === 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
  function bearerValid(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : cookie(req, 'suwayomi-server-token');
    return !!token && tokenValid(token);
  }
  /** 'ok' | 'http' (refus dès l'entrée, comme le mode basic) | 'gql' (erreur « Unauthorized » dans la réponse) */
  function access(req) {
    if (AUTH === 'none') return 'ok';
    if (AUTH === 'basic') return basicValid(req) ? 'ok' : 'http';
    if (AUTH === 'simple') return basicValid(req) ? 'ok' : 'gql';
    return bearerValid(req) ? 'ok' : 'gql';
  }

  // ───────────── Opérations GraphQL ─────────────
  const OPEN = new Set(['About', 'Login', 'Refresh']);
  const ops = {
    About: () => ({ aboutServer: { name: 'Suwayomi-Server (mock)', version: 'v2.4.0' } }),
    Probe: () => ({ categories: { totalCount: categories.length } }),
    Categories: () => ({ categories: { nodes: categories } }),
    Library: () => ({ mangas: { nodes: mangas.filter((m) => m.inLibrary).map(mangaDto) } }),
    Manga: ({ id }) => ({ manga: mangaDto(mangas.find((m) => m.id === id) || fail('No manga')) }),
    Chapters: ({ mangaId }) => ({ chapters: { nodes: chapters.filter((c) => c.mangaId === mangaId).sort((a, b) => a.sourceOrder - b.sourceOrder).map((c) => chapterDto(c)) } }),
    Chapter: ({ id }) => ({ chapter: chapterDto(chapters.find((c) => c.id === id) || fail('No chapter'), true) }),
    Latest: ({ first }) => ({ chapters: { nodes: chapters.filter(inLibrary).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, first).map((c) => chapterDto(c, true)) } }),
    InProgress: ({ first }) => ({ chapters: { nodes: chapters.filter((c) => inLibrary(c) && !c.isRead && c.lastPageRead > 0).sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, first).map((c) => chapterDto(c, true)) } }),
    RecentlyRead: ({ first }) => ({ chapters: { nodes: chapters.filter((c) => inLibrary(c) && c.lastReadAt > 0).sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, first).map((c) => chapterDto(c, true)) } }),
    Metas: ({ prefix }) => ({ metas: { nodes: [...metas].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })) } }),
    DeleteMeta: ({ key }) => { metas.delete(key); return { deleteGlobalMeta: { clientMutationId: null } }; },

    Pages: ({ id }) => {
      const c = chapters.find((x) => x.id === id) || fail('No chapter');
      c.pageCount = c._pages;
      return { fetchChapterPages: { pages: Array.from({ length: c._pages }, (_, i) => `/api/v1/manga/${c.mangaId}/chapter/${c.sourceOrder}/page/${i}`), chapter: chapterDto(c) } };
    },
    Progress: ({ id, isRead, lastPageRead }) => { patch([id], isRead, lastPageRead); return { updateChapter: { chapter: { id } } }; },
    ProgressMany: ({ ids, isRead, lastPageRead }) => { patch(ids, isRead, lastPageRead); return { updateChapters: { chapters: ids.map((id) => ({ id })) } }; },
    Enqueue: ({ ids }) => {
      for (const c of chapters.filter((x) => ids.includes(x.id))) { c.isDownloaded = true; c.pageCount = c._pages; }
      return { enqueueChapterDownloads: { clientMutationId: null } };
    },
    SetMeta: ({ key, value }) => { if (value.length > 4096) fail('Value too long for column "VALUE CHARACTER VARYING(4096)"'); metas.set(key, value); return { setGlobalMeta: { meta: { key } } }; },
    Login: ({ username, password }) => {
      if (username !== USER || password !== PASSWORD) fail('Incorrect username or password.');
      const refreshToken = makeToken(30 * DAY);
      refreshTokens.add(refreshToken);
      return { login: { accessToken: makeToken(TTL), refreshToken } };
    },
    Refresh: ({ token }) => {
      if (!refreshTokens.has(token) || !tokenValid(token)) fail('Unauthorized');
      return { refreshToken: { accessToken: makeToken(TTL) } };
    },
  };
  function fail(message) { throw new Error(message); }
  function patch(ids, isRead, lastPageRead) {
    for (const c of chapters.filter((x) => ids.includes(x.id))) {
      // Comme Suwayomi : une valeur absente (null) laisse le champ tel quel.
      if (isRead !== null && isRead !== undefined) c.isRead = isRead;
      if (lastPageRead !== null && lastPageRead !== undefined) c.lastPageRead = lastPageRead;
      c.lastReadAt = now();
    }
  }

  // ───────────── HTTP ─────────────
  return async function handle(req, res, path, q) {
    if (path === '/__mock/add-chapter' && req.method === 'POST') {
      const m = mangas.find((x) => x.id === Number(q.get('manga'))) || mangas[0];
      const n = chapters.filter((c) => c.mangaId === m.id).length + 1;
      return send(res, 200, chapterDto(addChapter(m, n, now(), true)));
    }
    const state = access(req);
    if (state === 'http') return send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });

    if (path === '/api/graphql' && req.method === 'POST') {
      const body = await readBody(req);
      const op = ops[body.operationName];
      if (!op) return send(res, 200, { errors: [{ message: `Unknown operation ${body.operationName}` }] });
      if (state !== 'ok' && !OPEN.has(body.operationName)) return send(res, 200, { errors: [{ message: 'Unauthorized' }], data: null });
      try { return send(res, 200, { data: op(body.variables || {}) }); }
      catch (e) { return send(res, 200, { errors: [{ message: e.message }], data: null }); }
    }

    if (state !== 'ok') return send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });
    let m;
    if ((m = path.match(/^\/api\/v1\/manga\/(\d+)\/thumbnail$/))) {
      const manga = mangas.find((x) => x.id === Number(m[1]));
      return manga ? svg(res, coverSvg(manga)) : send(res, 404, 'Not found');
    }
    if ((m = path.match(/^\/api\/v1\/manga\/(\d+)\/chapter\/(\d+)\/page\/(\d+)$/))) {
      const manga = mangas.find((x) => x.id === Number(m[1]));
      const c = chapters.find((x) => x.mangaId === Number(m[1]) && x.sourceOrder === Number(m[2]));
      const index = Number(m[3]);
      if (!manga || !c || index >= c._pages) return send(res, 404, 'Not found');
      return svg(res, pageSvg({ id: 'suwa' + c.id, _tall: manga.tall, _hue: manga._hue, seriesTitle: manga.title, number: c.chapterNumber }, index + 1));
    }
    return send(res, 404, 'Not found');
  };
}
