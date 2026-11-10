// Requêtes GraphQL envoyées à Suwayomi-Server. Regroupées ici pour être
// partagées avec dev/check-suwayomi.mjs, qui les rejoue contre un vrai serveur.
// Seuls des champs présents à la fois dans la version stable 2.4 et dans la
// préversion courante sont utilisés.

const CHAPTER = `
fragment ChapterFields on ChapterType {
  id name chapterNumber sourceOrder mangaId scanlator
  isRead isDownloaded lastPageRead lastReadAt pageCount uploadDate fetchedAt
}`;

const MANGA = `
fragment MangaFields on MangaType {
  id title author artist description genre status inLibrary inLibraryAt
  unreadCount downloadCount
  chapters { totalCount }
  categories { nodes { id } }
  latestFetchedChapter { fetchedAt }
  lastReadChapter { ...ChapterFields }
  firstUnreadChapter { ...ChapterFields }
}${CHAPTER}`;

export const Q = {
  About: 'query About { aboutServer { name version } }',
  // N'importe quelle requête protégée : sert à savoir si la session est valide.
  Probe: 'query Probe { categories(first: 1) { totalCount } }',

  Library: `query Library { mangas(condition: { inLibrary: true }) { nodes { ...MangaFields } } }${MANGA}`,
  Manga: `query Manga($id: Int!) { manga(id: $id) { ...MangaFields } }${MANGA}`,
  Categories: 'query Categories { categories { nodes { id name order } } }',

  Chapters: `query Chapters($mangaId: Int!) {
    chapters(condition: { mangaId: $mangaId }, orderBy: SOURCE_ORDER, orderByType: ASC) { nodes { ...ChapterFields } }
  }${CHAPTER}`,
  Chapter: `query Chapter($id: Int!) { chapter(id: $id) { ...ChapterFields manga { id title } } }${CHAPTER}`,
  Latest: `query Latest($first: Int!) {
    chapters(filter: { inLibrary: { equalTo: true } }, orderBy: FETCHED_AT, orderByType: DESC, first: $first) {
      nodes { ...ChapterFields manga { id title } }
    }
  }${CHAPTER}`,
  InProgress: `query InProgress($first: Int!) {
    chapters(
      filter: { inLibrary: { equalTo: true }, isRead: { equalTo: false }, lastPageRead: { greaterThan: 0 } }
      orderBy: LAST_READ_AT, orderByType: DESC, first: $first
    ) { nodes { ...ChapterFields manga { id title } } }
  }${CHAPTER}`,
  RecentlyRead: `query RecentlyRead($first: Int!) {
    chapters(filter: { inLibrary: { equalTo: true }, lastReadAt: { greaterThan: "0" } }, orderBy: LAST_READ_AT, orderByType: DESC, first: $first) {
      nodes { ...ChapterFields manga { id title } }
    }
  }${CHAPTER}`,

  Metas: 'query Metas($prefix: String!) { metas(filter: { key: { startsWith: $prefix } }) { nodes { key value } } }',

  // ── Mutations ──
  Pages: `mutation Pages($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages chapter { ...ChapterFields } } }${CHAPTER}`,
  Progress: `mutation Progress($id: Int!, $isRead: Boolean, $lastPageRead: Int) {
    updateChapter(input: { id: $id, patch: { isRead: $isRead, lastPageRead: $lastPageRead } }) { chapter { id } }
  }`,
  ProgressMany: `mutation ProgressMany($ids: [Int!]!, $isRead: Boolean, $lastPageRead: Int) {
    updateChapters(input: { ids: $ids, patch: { isRead: $isRead, lastPageRead: $lastPageRead } }) { chapters { id } }
  }`,
  Enqueue: 'mutation Enqueue($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { clientMutationId } }',
  DeleteMeta: 'mutation DeleteMeta($key: String!) { deleteGlobalMeta(input: { key: $key }) { clientMutationId } }',
  SetMeta: 'mutation SetMeta($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key } } }',
  Login: 'mutation Login($username: String!, $password: String!) { login(input: { username: $username, password: $password }) { accessToken refreshToken } }',
  Refresh: 'mutation Refresh($token: String!) { refreshToken(input: { refreshToken: $token }) { accessToken } }',
};

/** Requêtes en lecture seule, sans risque pour un serveur réel (utilisé par le script de vérification). */
export const READ_ONLY = ['About', 'Probe', 'Categories', 'Library', 'Latest', 'InProgress', 'RecentlyRead', 'Metas'];
