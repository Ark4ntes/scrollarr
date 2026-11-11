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
  if (String(url).endsWith('servers.json')) return { ok: true, json: async () => ({ plain: true, writer: true }) };
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

console.log(failed ? `\n${failed} test(s) failed` : '\nAll facade unit tests passed');
process.exit(failed ? 1 : 0);
