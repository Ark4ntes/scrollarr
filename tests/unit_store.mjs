// Unit tests for the subscriptions in app/js/store.js (refreshFavorites), with a test-only reader.
// Run with: node tests/unit_store.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'fr-FR' }, configurable: true }); } catch { /* déjà défini */ }
globalThis.fetch = async (url) => {
  if (String(url).endsWith('servers.json')) return { ok: true, json: async () => ({ lib: true }) };
  throw new TypeError('network');
};

const { CAP } = await import('../app/js/connectors/contract.js');
const { READERS } = await import('../app/js/connectors/index.js');
const net = await import('../app/js/net.js');

let seriesAnswer = 'ok';   // 'ok' | 404 | 500
const fn = () => {};
READERS.push({ id: 'lib', path: 'lib', create: () => ({
  id: 'lib', code: 'l', label: 'Lib', userLabel: 'User', capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ],
  ...Object.fromEntries(['login', 'logout', 'libraries', 'genres', 'seriesList', 'seriesNew', 'seriesUpdated', 'seriesBooks',
    'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead', 'book', 'bookPages', 'nextBook', 'previousBook',
    'seriesThumb', 'bookThumb'].map((m) => [m, fn])),
  session: async () => ({ name: 'tester' }),
  series: async (raw) => {
    if (seriesAnswer === 404) throw new net.ApiError(404);
    if (seriesAnswer === 500) throw new net.ApiError(500);
    return { id: raw, name: 'Serie ' + raw, booksCount: 12, metadata: {} };
  },
}) });

const api = await import('../app/js/api.js');
const favs = await import('../app/js/store.js');
await api.init();
await api.connect();

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const HOUR = 3600 * 1000;

let failed = 0;
async function test(name, run) {
  try { await run(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const stored = () => JSON.parse(localStorage.getItem('scrollarr.favorites')).items['l:1'];

favs.toggleFavorite({ id: 'l:1', name: 'Serie 1', booksCount: 10 });

await test('a first 404 keeps the subscription (marked, not deleted)', async () => {
  seriesAnswer = 404;
  const list = await favs.refreshFavorites();
  assert.ok(favs.isFavorite('l:1'));
  assert.equal(list.length, 1);              // toujours affiché, comme un serveur injoignable
  assert.equal(list[0].series, null);
  assert.equal(stored().goneSince, clock);
  assert.ok(!stored().del);
});
await test('a second 404 less than 24 h later still keeps it, and keeps the first date', async () => {
  const first = stored().goneSince;
  clock += 23 * HOUR;
  await favs.refreshFavorites();
  assert.ok(favs.isFavorite('l:1'));
  assert.equal(stored().goneSince, first);
});
await test('seeing the series again clears the mark', async () => {
  seriesAnswer = 'ok';
  const list = await favs.refreshFavorites();
  assert.equal(stored().goneSince, undefined);
  assert.equal(list[0].series.id, 'l:1');
  clock += 48 * HOUR;
  seriesAnswer = 404;
  await favs.refreshFavorites();             // repart de zéro : premier constat
  assert.ok(favs.isFavorite('l:1'));
  assert.equal(stored().goneSince, clock);
});
await test('another kind of error neither marks nor clears', async () => {
  const before = stored().goneSince;
  seriesAnswer = 500;
  clock += 30 * HOUR;
  await favs.refreshFavorites();
  assert.ok(favs.isFavorite('l:1'));
  assert.equal(stored().goneSince, before);
});
await test('a 404 on two refreshes at least 24 h apart deletes it (tombstone)', async () => {
  seriesAnswer = 404;
  await favs.refreshFavorites();             // 30 h après le premier constat
  assert.ok(!favs.isFavorite('l:1'));
  assert.equal(stored().del, 1);
  assert.ok(stored().rev > 1);
});

Date.now = realNow;
console.log(failed ? `\n${failed} test(s) failed` : '\nAll subscription unit tests passed');
process.exit(failed ? 1 : 0);
