// Intégration : le service démarre sur une bibliothèque d'essai et sa structure
// se parcourt en HTTP (bibliothèques → séries → chapitres), en mode password.
// Lancer avec : node tests/integration_folders.mjs
import assert from 'node:assert/strict';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { suite, fixture, passwordEnv, boot, get, post, CREDENTIALS } from './_folders.mjs';

const { test, run } = suite('folders integration');
const fx = fixture();
const app = await boot(passwordEnv(fx));
const cookie = (await post(app, '/api/v1/login', CREDENTIALS)).headers['set-cookie'][0].split(';')[0];
const api = (path) => get(app, path, { Cookie: cookie });
const ID = /^[0-9a-f]{16}$/;
let all = '';   // tout ce que le service a répondu, pour chercher des chemins
const seen = (res) => { all += res.text; return res; };

test('health: no session needed, lists libraries with their state and the auth mode', async () => {
  const res = seen(await get(app, '/health'));
  assert.deepEqual(res.json, { ok: true, version: '0.1.0', auth: 'password', libraries: [{ name: 'Autre', state: 'ok' }, { name: 'Scans', state: 'ok' }] });
});
let libs;
test('libraries: opaque identifiers and names', async () => {
  const res = seen(await api('/api/v1/libraries'));
  libs = res.json;
  assert.deepEqual(libs.map((l) => l.name), ['Autre', 'Scans']);
  assert.ok(libs.every((l) => ID.test(l.id) && Object.keys(l).length === 2));
});
let scans;
test('series of a library: sorted by title, common model, paging', async () => {
  const scansId = libs.find((l) => l.name === 'Scans').id;
  const res = seen(await api(`/api/v1/series?library=${scansId}`));
  scans = res.json.content;
  assert.deepEqual(scans.map((s) => s.name), ['Alpha Quest', 'Beta Folders', 'Delta Oneshot', 'Epsilon Mixte', 'Gamma Tomes', 'Solo Story']);
  assert.equal(res.json.last, true);
  assert.equal(res.json.totalElements, 6);
  const s = scans[0];
  assert.ok(ID.test(s.id) && s.libraryId === scansId);
  assert.deepEqual(Object.keys(s).sort(), ['booksCount', 'created', 'id', 'lastModified', 'libraryId', 'metadata', 'name']);
  assert.equal(s.booksCount, 3);
  const p = seen(await api(`/api/v1/series?library=${scansId}&size=4&page=1`));
  assert.deepEqual([p.json.content.length, p.json.last], [2, true]);
  assert.equal(seen(await api('/api/v1/series')).json.totalElements, 7); // toutes bibliothèques
});
test('series list: search, sort, and refused parameters', async () => {
  assert.deepEqual(seen(await api('/api/v1/series?search=tomes')).json.content.map((s) => s.name), ['Gamma Tomes']);
  assert.equal(seen(await api('/api/v1/series?sort=lastModified,desc')).json.content.length, 7);
  assert.equal((await api('/api/v1/series?sort=;drop')).status, 400);
  assert.equal((await api('/api/v1/series?size=0')).status, 400);
  assert.equal((await api('/api/v1/series?page=-1')).status, 400);
  assert.equal((await api('/api/v1/series?status=IN_PROGRESS')).status, 400); // pas de filtre simulé avant l'étape C
  assert.equal((await api('/api/v1/series?profile=../x')).status, 400);
  assert.equal((await api('/api/v1/series?profile=main')).status, 200);
  assert.equal((await api('/api/v1/series?library=0000000000000000')).status, 404);
});
test('a series and its chapters, in reading order', async () => {
  const beta = scans.find((s) => s.name === 'Beta Folders');
  assert.deepEqual(seen(await api(`/api/v1/series/${beta.id}`)).json, beta);
  const res = seen(await api(`/api/v1/series/${beta.id}/books`));
  const books = res.json.content;
  assert.deepEqual(books.map((b) => b.name), ['Chapitre 1', 'Chapitre 2', 'Chapitre 10']);
  assert.deepEqual(books.map((b) => b.metadata.numberSort), [1, 2, 10]);
  assert.deepEqual(books.map((b) => b.number), [1, 2, 3]);
  assert.ok(books.every((b) => b.id.startsWith(beta.id + '.') && b.seriesId === beta.id && b.seriesTitle === 'Beta Folders' && b.media.pagesCount >= 2));
  assert.equal(res.json.last, true);
});
test('a chapter, its neighbours, and the ends of the series', async () => {
  const gamma = scans.find((s) => s.name === 'Gamma Tomes');
  const books = seen(await api(`/api/v1/series/${gamma.id}/books`)).json.content;
  assert.deepEqual(books.map((b) => b.metadata.title), ['Tome 01 / Chapitre 001', 'Tome 01 / Chapitre 002.5', 'Tome 02 / Chapitre 010', 'Tome 02 / [Equipe] Chapitre 011']);
  assert.deepEqual(books.map((b) => b.media.mediaType), ['application/zip', 'application/zip', 'inode/directory', 'application/zip']);
  assert.deepEqual(seen(await api(`/api/v1/books/${books[1].id}`)).json, books[1]);
  assert.equal(seen(await api(`/api/v1/books/${books[1].id}/next`)).json.id, books[2].id);
  assert.equal(seen(await api(`/api/v1/books/${books[1].id}/previous`)).json.id, books[0].id);
  assert.equal((await api(`/api/v1/books/${books[0].id}/previous`)).status, 404);
  assert.equal((await api(`/api/v1/books/${books[3].id}/next`)).status, 404);
});
test('unknown or malformed identifiers: 404; traversal attempts never reach the disk', async () => {
  for (const path of ['/api/v1/series/0123456789abcdef', '/api/v1/series/0123456789abcdef/books', '/api/v1/books/0123456789abcdef.0123456789abcdef',
    '/api/v1/series/..', '/api/v1/series/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/api/v1/series/..%2fScans', '/api/v1/books/%2e%2e%2fsecret.txt',
    '/api/v1/series/ZZZZZZZZZZZZZZZZ', '/api/v1/series/' + 'a'.repeat(200), '/api/v1/books/0123456789abcdef/pages/1', '/api/v1/series/0123456789abcdef/thumbnail']) {
    const res = await api(path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.text.includes('/'), path); // le corps d'erreur ne contient aucun chemin
  }
});
test('symbolic links are not followed: no series, no chapter, a warning', async () => {
  assert.ok(!all.includes('Intrus') && !all.includes('secret.txt'));
  const warnings = seen(await api('/api/v1/scan')).json.warnings;
  assert.ok(warnings.some((w) => w.code === 'symlink' && w.entry === 'Lien vers dehors'));
});
test('scan: state, warnings, and a manual rescan', async () => {
  const before = seen(await api('/api/v1/scan')).json;
  assert.deepEqual([before.running, before.series, before.books], [false, 7, 14]);
  assert.ok(['no-chapters', 'empty-archive', 'too-deep', 'loose-images'].every((c) => before.warnings.some((w) => w.code === c)));
  const started = await post(app, '/api/v1/scan', {}, { Cookie: cookie });
  assert.equal(started.status, 202);
  let state;
  for (let i = 0; i < 50; i++) { state = (await api('/api/v1/scan')).json; if (!state.running) break; await new Promise((r) => setTimeout(r, 20)); }
  assert.equal(state.running, false);
  assert.ok(state.lastScan.finishedAt >= before.lastScan.finishedAt);
});
test('unmounted library: 503 on its routes, the other library stays readable, 200 again once back', async () => {
  const omega = (await api('/api/v1/series?library=' + libs.find((l) => l.name === 'Autre').id)).json.content[0];
  const book = (await api(`/api/v1/series/${omega.id}/books`)).json.content[0];
  renameSync(join(fx.libraries, 'Autre'), join(fx.root, 'demonte'));
  for (const path of [`/api/v1/series?library=${libs.find((l) => l.name === 'Autre').id}`, '/api/v1/series', `/api/v1/series/${omega.id}`, `/api/v1/series/${omega.id}/books`, `/api/v1/books/${book.id}`, `/api/v1/books/${book.id}/next`]) {
    const res = await api(path);
    assert.equal(res.status, 503, path);
    assert.equal(res.headers['retry-after'], '5');
  }
  assert.equal((await api('/api/v1/series?library=' + libs.find((l) => l.name === 'Scans').id)).status, 200);
  assert.deepEqual((await get(app, '/health')).json.libraries.map((l) => l.state), ['unavailable', 'ok']);
  assert.equal((await api('/api/v1/series/0123456789abcdef')).status, 503); // inconnu mais indécidable : jamais 404
  renameSync(join(fx.root, 'demonte'), join(fx.libraries, 'Autre'));
  assert.equal((await api(`/api/v1/series/${omega.id}`)).status, 200);
  assert.equal((await api('/api/v1/series/0123456789abcdef')).status, 404);
});
test('no response mentions a filesystem path', () => {
  assert.ok(!all.includes(fx.root) && !all.includes(fx.libraries) && !all.includes('/tmp'));
});

try { await run(); } finally { await app.close(); }
