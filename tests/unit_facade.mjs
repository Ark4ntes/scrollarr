// Unit tests for the facade (app/js/api.js) with test-only readers injected in the registry.
// No browser: the few globals the facade needs are stubbed. Run with: node tests/unit_facade.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); } catch { /* déjà défini */ }
// servers.json annonce nos deux lecteurs de test ; les vrais serveurs sont absents (fetch échoue).
globalThis.fetch = async (url) => {
  if (String(url).endsWith('servers.json')) return { ok: true, json: async () => ({ plain: true, writer: true, keeper: true }) };
  throw new TypeError('network');
};

const { CAP } = await import('../app/js/connectors/contract.js');
const { READERS } = await import('../app/js/connectors/index.js');

const calls = [];
const fn = () => {};
const book = (id) => ({ id, seriesId: 's1', media: { pagesCount: 3 }, metadata: {} });
function makeReader(id, code, withProgress) {
  const rec = (name) => async (...a) => { calls.push([id, name, ...a]); };
  return {
    id, code, label: id, userLabel: 'User',
    capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ, ...(withProgress ? [CAP.PROGRESS_WRITE] : [])],
    ...Object.fromEntries(['login', 'logout', 'libraries', 'genres', 'seriesList', 'seriesNew', 'seriesUpdated', 'series', 'seriesBooks',
      'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead', 'bookPages', 'nextBook', 'previousBook',
      'seriesThumb', 'bookThumb'].map((m) => [m, fn])),
    session: async () => ({ name: 'tester' }),
    book: async (raw) => book(raw),
    ...(withProgress ? Object.fromEntries(['saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread'].map((m) => [m, rec(m)])) : {}),
  };
}
READERS.push({ id: 'plain', path: 'plain', create: () => makeReader('plain', 'n', false) });
// Lecteur qui tient lui-même la progression de chaque profil (comme Dossiers).
function makeKeeper() {
  const r = makeReader('keeper', 'q', true);
  const rec = (name, result) => async (...a) => { calls.push(['keeper', name, ...a]); return result; };
  const row = (id, date) => ({ id, seriesId: 's9', seriesTitle: 'Keeper series', name: id, readProgress: { page: 1, completed: false, readDate: date } });
  return {
    ...r,
    capabilities: [...r.capabilities, CAP.PROGRESS_READ, CAP.PROGRESS_PROFILES],
    setProfile: rec('setProfile'), forgetProfile: rec('forgetProfile'),
    booksInProgress: rec('booksInProgress', { content: [row('kb1', '2026-01-03T00:00:00.000Z')] }),
    booksRecentlyRead: rec('booksRecentlyRead', { content: [row('kb1', '2026-01-03T00:00:00.000Z'), row('kb2', '2026-01-01T00:00:00.000Z')] }),
    seriesList: async () => ({ content: [{ id: 's9', booksCount: 4, booksReadCount: 1, booksInProgressCount: 1, booksUnreadCount: 2, metadata: { title: 'K' } }], last: true }),
    book: async (raw) => ({ ...book(raw), readProgress: { page: 7, completed: false, readDate: '2026-01-02T00:00:00.000Z' } }),
  };
}
READERS.push({ id: 'keeper', path: 'keeper', create: makeKeeper });
READERS.push({ id: 'writer', path: 'writer', create: () => makeReader('writer', 'w', true) });

const api = await import('../app/js/api.js');
await api.init();
await api.connect();

let failed = 0;
async function test(name, run) {
  try { calls.length = 0; store.clear(); await run(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const queue = () => JSON.parse(store.get('scrollarr.progressQueue') || '{}');

await test('a reader without progress.write is reachable but not writable', () => {
  assert.equal(api.can('n:1', CAP.PROGRESS_WRITE), false);
  assert.equal(api.can('w:1', CAP.PROGRESS_WRITE), true);
  assert.ok(api.reachable('n:1'));
});
await test('saveProgress records nothing for a reader without progress.write', async () => {
  assert.equal(await api.saveProgress('n:1', 2, false), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(queue(), {});
  assert.equal(api.pendingProgress('n:1'), undefined);
});
await test('mark read/unread (chapter and series) do nothing for a reader without progress.write', async () => {
  for (const m of ['markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread']) await api[m]('n:1');
  assert.deepEqual(calls, []);
});
await test('a reader with progress.write still records progress and mark actions', async () => {
  await api.saveProgress('w:1', 2, false);
  await api.markBookRead('w:1');
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['writer', 'saveProgress'], ['writer', 'markBookRead']]);
  assert.deepEqual(queue(), {}); // file vidée une fois envoyé
});
await test('a secondary profile overlay records nothing for a reader without progress.write', async () => {
  const seen = [];
  api.setOverlay({
    seriesStats: () => ({ read: 0, inProgress: 0 }), progressOf: () => undefined,
    record: (b) => seen.push(['record', b.id]), forget: (bs) => seen.push(['forget', bs.length]), flush: async () => {}, recent: () => [],
  });
  await api.saveProgress('n:1', 2, true);
  await api.markBookRead('n:1');
  await api.markBookUnread('n:1');
  assert.deepEqual(seen, []);
  await api.saveProgress('w:1', 2, true);
  assert.equal(seen.length, 1); // le lecteur qui déclare la capacité reste enregistré
  api.setOverlay(null);
});
await test('reading still works: book, pages and thumbnails are served without progress.write', async () => {
  assert.equal((await api.book('n:7')).id, 'n:7');
  api.bookPages('n:7'); api.bookThumb('n:7');
});

await test('the reading-status filter is offered only when every used server can filter (none of the test readers can)', () => {
  assert.equal(api.canFilterByStatus(), false);
});

await test('hasStore is true only when an enabled server declares settings.store (none of the test readers does)', () => {
  assert.equal(api.hasStore(), false);
});

// ── Lecteur qui tient la progression par profil : délégation, surcouche inchangée pour les autres ──
const fakeOverlay = (seen) => ({
  seriesStats: () => ({ read: 0, inProgress: 0 }), progressOf: () => ({ page: 99, completed: false, readDate: '2026-01-02T12:00:00.000Z' }),
  record: (b) => seen.push(['record', b.id]), forget: (bs) => seen.push(['forget', bs.length]), flush: async () => {},
  recent: () => [{ id: 'w:5', seriesId: 'w:s', seriesTitle: 'Overlay series', readProgress: { page: 2, completed: false, readDate: '2026-01-02T00:00:00.000Z' } }],
});
await test('setProfile tells only the readers that declare chapter.progress.profiles', () => {
  api.setProfile('p1');
  assert.deepEqual(calls, [['keeper', 'setProfile', 'p1']]);
  api.setProfile('main');
});
await test('secondary profile: progress of a keeper chapter is delegated, never recorded in the overlay', async () => {
  const seen = [];
  api.setProfile('p1');
  api.setOverlay(fakeOverlay(seen));
  calls.length = 0;
  await api.saveProgress('q:1', 3, false);
  await api.markBookRead('q:1'); await api.markBookUnread('q:1'); await api.markSeriesRead('q:s9'); await api.markSeriesUnread('q:s9');
  assert.deepEqual(seen, []);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['keeper', 'saveProgress'], ['keeper', 'markBookRead'], ['keeper', 'markBookUnread'], ['keeper', 'markSeriesRead'], ['keeper', 'markSeriesUnread']]);
  assert.deepEqual(queue(), {}, 'queue emptied once sent');
  // …et celle d'un lecteur sans cette capacité passe toujours par la surcouche
  await api.saveProgress('w:1', 3, false);
  assert.deepEqual(seen, [['record', 'w:1']]);
  api.setOverlay(null); api.setProfile('main');
});
await test('secondary profile: a keeper chapter and series keep what the reader says; others get the overlay', async () => {
  api.setProfile('p1');
  api.setOverlay(fakeOverlay([]));
  assert.equal((await api.book('q:1')).readProgress.page, 7);
  assert.equal((await api.book('w:1')).readProgress.page, 99);
  const k = (await api.seriesList({ libraryId: undefined, size: 50 })).content.find((x) => x.id === 'q:s9');
  assert.deepEqual([k.booksReadCount, k.booksInProgressCount, k.booksUnreadCount], [1, 1, 2]);
  api.setOverlay(null); api.setProfile('main');
});
await test('secondary profile: "in progress" and "recent" merge the overlay and the keeper, newest first', async () => {
  api.setProfile('p1');
  api.setOverlay(fakeOverlay([]));
  assert.deepEqual((await api.booksInProgress(10)).content.map((b) => b.id), ['q:kb1', 'w:5']);
  assert.deepEqual((await api.booksRecentlyRead(10)).content.map((b) => b.id), ['q:kb1', 'w:5', 'q:kb2']);
  assert.deepEqual((await api.booksRecentlyRead(2)).content.map((b) => b.id), ['q:kb1', 'w:5']);
  api.setOverlay(null); api.setProfile('main');
});
await test('a queued save of a keeper chapter belongs to the profile that made it', async () => {
  api.setProfile('p1');
  // Entrées laissées par des sauvegardes hors ligne : « chapitre@profil » pour un profil secondaire, « chapitre » pour le principal.
  store.set('scrollarr.progressQueue', JSON.stringify({ 'q:1@p1': { page: 4, completed: false, t: 1 }, 'q:2@p2': { page: 5, completed: false, t: 1 }, 'q:3': { page: 6, completed: false, t: 1 } }));
  calls.length = 0;
  assert.deepEqual(api.pendingProgress('q:1'), { page: 4, completed: false, t: 1 });
  await api.flushProgress();
  const sent = calls.filter((c) => c[1] === 'saveProgress').map((c) => c[2]);
  assert.deepEqual(sent, ['1'], 'only the active profile is sent');
  assert.deepEqual(Object.keys(queue()).sort(), ['q:2@p2', 'q:3']);
  api.setProfile('main');
});
await test('forgetProfile asks the keeper readers, and retries later what failed', async () => {
  await api.forgetProfile('p1');
  assert.deepEqual(calls.filter((c) => c[1] === 'forgetProfile'), [['keeper', 'forgetProfile', 'p1']]);
  assert.equal(store.get('scrollarr.forgetProfile'), '{}');
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll facade unit tests passed');
process.exit(failed ? 1 : 0);
