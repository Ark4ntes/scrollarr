// Unit tests for the folders reader (app/js/connectors/readers/folders.js) with a stubbed fetch. No browser.
// Run with: node tests/unit_folders_reader.mjs
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); } catch { /* déjà défini */ }

const calls = [];
let answer = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
  return answer(String(url), opts);
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const { CAP } = await import('../app/js/connectors/contract.js');
const { validateReader } = await import('../app/js/connectors/reader-contract.js');
const { READERS } = await import('../app/js/connectors/index.js');
const { createFolders } = await import('../app/js/connectors/readers/folders.js');
const { AuthError, OfflineError, ApiError, retryNow } = await import('../app/js/net.js');

const reader = () => createFolders({ base: '/folders' });
let failed = 0;
async function test(name, run) {
  try { calls.length = 0; retryNow(); answer = () => json({}); await run(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n  ')); }
}

await test('the reader respects the reader contract', () => {
  const r = validateReader(reader());
  assert.equal(r.id, 'folders');
  assert.match(r.code, /^[a-z]$/);
  assert.equal(r.settings, undefined);
  for (const cap of r.capabilities) assert.ok(Object.values(CAP).includes(cap));
});
await test('it never declares settings.store (profiles and subscriptions are not its business)', () => {
  assert.ok(!reader().capabilities.includes(CAP.SETTINGS_STORE));
});
await test('it declares progress read and write, and implements every member that goes with them', () => {
  const r = reader();
  assert.ok(r.capabilities.includes(CAP.PROGRESS_READ) && r.capabilities.includes(CAP.PROGRESS_WRITE));
  for (const m of ['saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread', 'booksInProgress', 'booksRecentlyRead']) assert.equal(typeof r[m], 'function', m);
});
await test('progress: saveProgress and the mark-read calls hit the right routes, with a JSON body even when empty', async () => {
  const r = reader();
  answer = () => new Response(null, { status: 204 });
  await r.saveProgress('s.b', 4, false, { keepalive: true });
  await r.markBookRead('s.b');
  await r.markBookUnread('s.b');
  await r.markSeriesRead('s');
  await r.markSeriesUnread('s');
  const seen = calls.map((c) => `${c.method} ${c.url}`);
  assert.deepEqual(seen, ['PATCH /folders/api/v1/books/s.b/progress', 'PATCH /folders/api/v1/books/s.b/progress', 'DELETE /folders/api/v1/books/s.b/progress',
    'PUT /folders/api/v1/series/s/progress', 'DELETE /folders/api/v1/series/s/progress']);
  assert.deepEqual(JSON.parse(calls[0].body), { page: 4, completed: false });
  assert.deepEqual(JSON.parse(calls[1].body), { completed: true });
  for (const c of calls) assert.ok(c.body !== undefined && JSON.parse(c.body), 'corps JSON présent : ' + c.method + ' ' + c.url);
  for (const c of calls) assert.equal(new Headers(c.headers).get('content-type'), 'application/json');
});
await test('progress: in-progress and recently-read lists, and the reading status filter', async () => {
  const r = reader();
  answer = () => json({ content: [] });
  await r.booksInProgress(12);
  await r.booksRecentlyRead(100);
  await r.seriesList({ readStatus: 'IN_PROGRESS', size: 5 });
  await r.seriesList({ size: 5 });
  assert.deepEqual(calls.map((c) => c.url), ['/folders/api/v1/books/inprogress?size=12', '/folders/api/v1/books/recent?size=100',
    '/folders/api/v1/series?status=IN_PROGRESS&sort=metadata.titleSort%2Casc&page=0&size=5', '/folders/api/v1/series?sort=metadata.titleSort%2Casc&page=0&size=5']);
});
await test('registered last, with a code no other reader uses', () => {
  const ids = READERS.map((r) => r.id);
  assert.equal(ids.at(-1), 'folders');
  const codes = READERS.map((r) => r.create({ base: '/x' }).code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(READERS.at(-1).path, 'folders');
});

await test('libraries: a single library gives an empty list, several are returned', async () => {
  answer = () => json([{ id: 'a', name: 'Scans' }]);
  assert.deepEqual(await reader().libraries(), []);
  answer = () => json([{ id: 'a', name: 'Scans' }, { id: 'b', name: 'Autre' }]);
  assert.equal((await reader().libraries()).length, 2);
  assert.equal(calls.at(-1).url, '/folders/api/v1/libraries');
});
await test('genres, new series and latest/on-deck lists are empty without any request', async () => {
  const r = reader();
  assert.deepEqual(await r.genres(), []);
  assert.deepEqual(await r.seriesNew(20), { content: [] });
  assert.deepEqual(await r.booksLatest(20), { content: [] });
  assert.deepEqual(await r.booksOnDeck(20), { content: [] });
  assert.equal(calls.length, 0);
});
await test('seriesList maps title, search, library, sort and paging; empty values are left out', async () => {
  await reader().seriesList({ libraryId: 'b', search: 'tomes', sort: 'updated', page: 2, size: 36 });
  assert.equal(calls[0].url, '/folders/api/v1/series?library=b&search=tomes&sort=lastModified%2Cdesc&page=2&size=36');
  await reader().seriesList({});
  assert.equal(calls[1].url, '/folders/api/v1/series?sort=metadata.titleSort%2Casc&page=0&size=30');
});
await test('seriesUpdated asks for the most recently modified folders', async () => {
  await reader().seriesUpdated(18);
  assert.equal(calls[0].url, '/folders/api/v1/series?sort=lastModified%2Cdesc&size=18');
});
await test('seriesBooks returns the chapters in the order of the service', async () => {
  answer = () => json({ content: [{ id: 'x.1' }, { id: 'x.2' }], last: true });
  assert.deepEqual((await reader().seriesBooks('x')).map((b) => b.id), ['x.1', 'x.2']);
  assert.equal(calls[0].url, '/folders/api/v1/series/x/books');
});
await test('next and previous: 404 means no neighbour, other errors are raised', async () => {
  answer = () => json({ error: 'not found' }, 404);
  assert.equal(await reader().nextBook('a.b'), null);
  answer = () => json({ error: 'x' }, 500);
  await assert.rejects(() => reader().previousBook('a.b'), ApiError);
});
await test('bookPages: URLs of the service pages, no dimensions, no fallback (images are served as they are)', async () => {
  answer = () => json([{ number: 1, mediaType: 'image/png' }, { number: 2, mediaType: 'image/jpeg' }]);
  const pages = await reader().bookPages('s1.c1');
  assert.deepEqual(pages, [
    { number: 1, mediaType: 'image/png', url: '/folders/api/v1/books/s1.c1/pages/1' },
    { number: 2, mediaType: 'image/jpeg', url: '/folders/api/v1/books/s1.c1/pages/2' },
  ]);
});
await test('thumbnails: a chapter uses the cover of its series (one image per series)', () => {
  const r = reader();
  assert.equal(r.seriesThumb('abc'), '/folders/api/v1/series/abc/thumbnail');
  assert.equal(r.bookThumb('abc.def'), '/folders/api/v1/series/abc/thumbnail');
});

await test('session in mode none: no name, so no "signed in as" and no sign-out button', async () => {
  answer = () => json({ authenticated: true, user: null, auth: 'none' });
  assert.deepEqual(await reader().session(), { name: null });
  assert.equal(calls[0].url, '/folders/api/v1/session');
});
await test('session in mode password: the shared user name; 401 is an AuthError (login card)', async () => {
  answer = () => json({ authenticated: true, user: 'lecteur', auth: 'password' });
  assert.deepEqual(await reader().session(), { name: 'lecteur' });
  answer = () => json({ error: 'unauthorized' }, 401);
  await assert.rejects(() => reader().session(), AuthError);
});
await test('login posts credentials as JSON; a wrong password is an AuthError', async () => {
  const r = reader();
  answer = () => json({ error: 'invalid credentials' }, 401);
  await assert.rejects(() => r.login('lecteur', 'x'), AuthError);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, '/folders/api/v1/login');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].headers['X-Requested-With'], 'XMLHttpRequest');
  assert.deepEqual(JSON.parse(calls[0].body), { username: 'lecteur', password: 'x' });
  answer = () => json({ authenticated: true, user: 'lecteur' });
  assert.deepEqual(await r.login('lecteur', 'bon'), { name: 'lecteur' });
});
await test('mode none: login is refused and logout does nothing (no request)', async () => {
  const r = reader();
  answer = () => json({ authenticated: true, user: null, auth: 'none' });
  await r.session();
  calls.length = 0;
  await assert.rejects(() => r.login('a', 'b'), ApiError);
  await r.logout();
  assert.equal(calls.length, 0);
});
await test('a request without body still carries a JSON body and Content-Type (the service requires both on every write)', async () => {
  const r = reader();
  answer = () => json({ authenticated: true, user: 'lecteur', auth: 'password' });
  await r.session();
  calls.length = 0;
  answer = () => new Response(null, { status: 204 });
  await r.logout();
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, '{}');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].headers['X-Requested-With'], 'XMLHttpRequest');
});
await test('a stopped service (502 from the proxy) reads as "server unreachable"', async () => {
  answer = () => new Response('', { status: 502 });
  await assert.rejects(() => reader().series('x'), OfflineError);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll folders reader unit tests passed');
process.exit(failed ? 1 : 0);
