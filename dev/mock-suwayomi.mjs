// Imitation de Suwayomi-Server pour le serveur de démonstration (voir mock-servers.mjs).
// Répond aux opérations GraphQL envoyées par app/js/connectors/readers/suwayomi.js (et collectors/suwayomi.js) et
// reproduit les quatre modes d'authentification de Suwayomi.
//
//   SUWA_AUTH=none|basic|simple|ui   mode d'authentification (défaut : none)
//   SUWA_TOKEN_TTL=300               durée de vie du jeton en mode « ui », en secondes
//   Identifiants : demo / demo
//   SOURCE_SLOW_MS=2500              délai de la source lente (voir « Sources » plus bas)
//   POST /suwayomi/__mock/add-chapter?manga=<id>   simule l'arrivée d'un chapitre
//   GET  /suwayomi/__mock/requests   opérations GraphQL reçues, dans l'ordre (pour vérifier qu'aucune recherche n'est partie seule)

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
  // File de téléchargement. Sans DOWNLOAD_MS, un chapitre demandé est disponible aussitôt.
  // Avec DOWNLOAD_MS=<durée par chapitre>, la file avance dans le temps, un chapitre à la fois ;
  // DOWNLOAD_FAIL=<id de chapitre> fait échouer ce chapitre la première fois ; une relance réussit.
  const DOWNLOAD_MS = Number(process.env.DOWNLOAD_MS || 0);
  const DOWNLOAD_FAIL = Number(process.env.DOWNLOAD_FAIL || 0);
  let failedOnce = false;
  let queue = []; // { chapterId, state, progress, tries, startedAt }
  function tickQueue() {
    const now = Date.now();
    for (const item of queue) {
      if (item.state === 'ERROR') continue;
      if (item.state === 'QUEUED') { item.state = 'DOWNLOADING'; item.startedAt = now; }
      item.progress = Math.min(1, (now - item.startedAt) / DOWNLOAD_MS);
      if (item.chapterId === DOWNLOAD_FAIL && !failedOnce && item.progress >= 0.5) { failedOnce = true; item.state = 'ERROR'; item.tries = 3; item.progress = 0; continue; }
      if (item.progress < 1) break; // un seul téléchargement à la fois
      const c = chapters.find((x) => x.id === item.chapterId);
      c.isDownloaded = true; c.pageCount = c._pages; item.state = 'FINISHED';
    }
    queue = queue.filter((item) => item.state !== 'FINISHED');
  }
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

  // ───────────── Sources (recherche et ajout depuis Scrollarr) ─────────────
  // Comme un vrai serveur : une recherche range ses résultats dans la base, hors bibliothèque, avec un numéro réel ;
  // la liste des chapitres n'est récupérée qu'à la demande (FetchChapters). Les résultats sont les mêmes à chaque fois.
  //   1001 MangaFixe    fr   répond vite, a d'autres pages de résultats
  //   1002 ScanDemo     en
  //   1003 SourceLente  fr   répond après SOURCE_SLOW_MS
  //   1004 SourceCassée fr   échoue toujours (erreur GraphQL, comme une extension dont le site est tombé)
  //   1005 AdultesDemo  fr   signalée « adulte » par le serveur
  //   1006 Multilingue  all
  //   0    Local source : n'est pas un site où chercher
  const SLOW_MS = Number(process.env.SOURCE_SLOW_MS || 2500);
  const sources = [
    { id: '1001', name: 'MangaFixe', lang: 'fr', isNsfw: false, pkg: 'demo.mangafixe' },
    { id: '1002', name: 'ScanDemo', lang: 'en', isNsfw: false, pkg: 'demo.scandemo' },
    { id: '1003', name: 'SourceLente', lang: 'fr', isNsfw: false, pkg: 'demo.lente', slow: true },
    { id: '1004', name: 'SourceCassée', lang: 'fr', isNsfw: false, pkg: 'demo.cassee', fails: true },
    { id: '1005', name: 'AdultesDemo', lang: 'fr', isNsfw: true, pkg: 'demo.adultes' },
    { id: '1006', name: 'Multilingue', lang: 'all', isNsfw: false, pkg: 'demo.multi' },
    { id: '0', name: 'Local source', lang: 'localsourcelang', isNsfw: false, pkg: 'local' },
  ];
  // `existing` : le titre est déjà dans la bibliothèque (numéro de la série concernée).
  const catalogue = [
    { source: '1001', title: 'Lune d’Acier', chapters: 12, hue: 210 },
    { source: '1001', title: 'Café Lune Rouge', existing: 2 },
    { source: '1001', title: 'Lune de Papier', chapters: 8, hue: 40 },
    { source: '1002', title: 'Steel Moon', chapters: 10, hue: 190 },
    { source: '1002', title: 'Moonlit Garden', chapters: 6, hue: 120 },
    { source: '1003', title: 'Lune Lente', chapters: 5, hue: 300 },
    { source: '1005', title: 'Lune Interdite', chapters: 4, hue: 350 },
    { source: '1006', title: 'Lune Polyglotte', chapters: 7, hue: 70 },
    { source: '1006', title: 'Dojo Tanuki', existing: 6 },
    { source: '1001', title: 'Brumes d’Automne', chapters: 9, hue: 260 },
  ];
  const fold = (x) => String(x).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Le manga que le serveur range dans sa base quand une recherche le renvoie. */
  function materialize(entry) {
    if (entry.existing) return mangas.find((m) => m.id === entry.existing);
    const id = 100 + catalogue.indexOf(entry);
    let m = mangas.find((x) => x.id === id);
    if (!m) {
      m = { id, title: entry.title, author: null, artist: null, description: null, genre: [], status: 'UNKNOWN', inLibrary: false, inLibraryAt: 0,
        categoryIds: [], tall: false, _hue: entry.hue, metadata: { title: entry.title }, _chapters: entry.chapters, _source: entry.source };
      mangas.push(m);
    }
    return m;
  }

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
    Sources: () => ({ sources: { nodes: sources.map((x) => ({ id: x.id, name: x.name, lang: x.lang, iconUrl: `/api/v1/extension/icon/${x.pkg}`, isNsfw: x.isNsfw })) } }),
    SourceSearch: async ({ source, query }) => {
      const src = sources.find((x) => x.id === source) || fail(`Source ${source} not found`);
      if (src.fails) fail('Failed to connect to https://source-cassee.invalid');
      if (src.slow) await sleep(SLOW_MS);
      const needle = fold(query);
      const hits = catalogue.filter((e) => e.source === source && fold(e.title).includes(needle));
      return { fetchSourceManga: { hasNextPage: source === '1001' && hits.length > 1, mangas: hits.map((e) => {
        const m = materialize(e);
        return { id: m.id, title: m.title, thumbnailUrl: `/api/v1/manga/${m.id}/thumbnail`, inLibrary: m.inLibrary };
      }) } };
    },
    AddToLibrary: ({ id }) => {
      const m = mangas.find((x) => x.id === id) || fail('No manga');
      m.inLibrary = true; m.inLibraryAt = now();
      return { updateManga: { manga: { id: m.id, inLibrary: true } } };
    },
    FetchChapters: async ({ id }) => {
      const m = mangas.find((x) => x.id === id) || fail('No manga');
      if (m._noChapters) fail('Chapter list unavailable');
      // Le premier appel va chercher les chapitres chez la source (aucun n'est téléchargé) ; les suivants renvoient ce qui existe.
      if (!chapters.some((c) => c.mangaId === m.id)) {
        for (let n = 1; n <= (m._chapters || 5); n++) addChapter(m, n, now() - ((m._chapters || 5) - n) * DAY, false);
      }
      return { fetchChapters: { chapters: chapters.filter((c) => c.mangaId === m.id).map((c) => ({ id: c.id })) } };
    },
    DeleteMeta: ({ key }) => { metas.delete(key); return { deleteGlobalMeta: { clientMutationId: null } }; },

    Pages: ({ id }) => {
      const c = chapters.find((x) => x.id === id) || fail('No chapter');
      c.pageCount = c._pages;
      return { fetchChapterPages: { pages: Array.from({ length: c._pages }, (_, i) => `/api/v1/manga/${c.mangaId}/chapter/${c.sourceOrder}/page/${i}`), chapter: chapterDto(c) } };
    },
    Progress: ({ id, isRead, lastPageRead }) => { patch([id], isRead, lastPageRead); return { updateChapter: { chapter: { id } } }; },
    ProgressMany: ({ ids, isRead, lastPageRead }) => { patch(ids, isRead, lastPageRead); return { updateChapters: { chapters: ids.map((id) => ({ id })) } }; },
    Enqueue: ({ ids }) => {
      for (const c of chapters.filter((x) => ids.includes(x.id))) {
        if (!DOWNLOAD_MS) { c.isDownloaded = true; c.pageCount = c._pages; }
        else if (!c.isDownloaded && !queue.some((q) => q.chapterId === c.id)) queue.push({ chapterId: c.id, state: 'QUEUED', progress: 0, tries: 0, startedAt: 0 });
      }
      return { enqueueChapterDownloads: { clientMutationId: null } };
    },
    Dequeue: ({ ids }) => { queue = queue.filter((q) => !ids.includes(q.chapterId)); return { dequeueChapterDownloads: { clientMutationId: null } }; },
    Downloads: () => {
      tickQueue();
      return { downloadStatus: { state: 'STARTED', queue: queue.map((q, position) => {
        const c = chapters.find((x) => x.id === q.chapterId);
        return { state: q.state, progress: q.progress, tries: q.tries, position, chapter: { id: c.id, name: c.name, mangaId: c.mangaId }, manga: { id: c.mangaId, title: mangas.find((m) => m.id === c.mangaId).title } };
      }) } };
    },
    ChaptersState: ({ ids }) => {
      tickQueue();
      return { chapters: { nodes: chapters.filter((c) => ids.includes(c.id)).map((c) => ({ id: c.id, name: c.name, mangaId: c.mangaId, isDownloaded: c.isDownloaded, manga: { id: c.mangaId, title: mangas.find((m) => m.id === c.mangaId).title } })) } };
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
  const requests = [];
  return async function handle(req, res, path, q) {
    if (path === '/__mock/requests') return send(res, 200, requests);
    if (path === '/__mock/add-chapter' && req.method === 'POST') {
      const m = mangas.find((x) => x.id === Number(q.get('manga'))) || mangas[0];
      const n = chapters.filter((c) => c.mangaId === m.id).length + 1;
      return send(res, 200, chapterDto(addChapter(m, n, now(), true)));
    }
    const state = access(req);
    if (state === 'http') return send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });

    if (path === '/api/graphql' && req.method === 'POST') {
      const body = await readBody(req);
      requests.push(body.operationName);
      const op = ops[body.operationName];
      if (!op) return send(res, 200, { errors: [{ message: `Unknown operation ${body.operationName}` }] });
      if (state !== 'ok' && !OPEN.has(body.operationName)) return send(res, 200, { errors: [{ message: 'Unauthorized' }], data: null });
      try { return send(res, 200, { data: await op(body.variables || {}) }); }
      catch (e) { return send(res, 200, { errors: [{ message: e.message }], data: null }); }
    }

    if (state !== 'ok') return send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });
    let m;
    if (path.startsWith('/api/v1/extension/icon/')) return svg(res, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="hsl(${path.length * 37 % 360} 60% 45%)"/></svg>`);
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
