// Intégration : pages et couvertures lues en HTTP (READ-002 §4.4, §4.8, §4.10), mode password.
// Archives hostiles fabriquées ici ; vérifie aussi qu'aucun fichier n'est écrit et que la lecture est en flux.
// Lancer avec : node tests/integration_folders_pages.mjs
import assert from 'node:assert/strict';
import fs, { rmSync, renameSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { suite, fixture, passwordEnv, boot, get, post, put, snapshot, openFds, sleep, CREDENTIALS } from './_folders.mjs';
import { png, zip } from '../dev/make-folders-fixture.mjs';

const { test, run } = suite('folders pages integration');
const fx = fixture();
const red = png(200, 0, 0), green = png(0, 200, 0), blue = png(0, 0, 200);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)]);
const filler = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);

// Contenus propres à ces tests, ajoutés avant le démarrage.
const S = 'Scans';
put(fx.libraries, `${S}/Pages Dossier/Chapitre 1/10.png`, blue);
put(fx.libraries, `${S}/Pages Dossier/Chapitre 1/2.png`, green);
put(fx.libraries, `${S}/Pages Dossier/Chapitre 1/1.png`, red);
put(fx.libraries, `${S}/Pages Dossier/Chapitre 1/notes.txt`, 'pas une image');
put(fx.libraries, `${S}/Pages Dossier/Chapitre 1/.cache.png`, red);
put(fx.libraries, `${S}/Pages Dossier/Chapitre 2/1.jpg`, jpeg);
put(fx.libraries, `${S}/Pages Dossier/cover.jpg`, jpeg);
put(fx.libraries, `${S}/Archives Sans Couverture/Chapitre 2.cbz`, zip({ '1.png': blue }));
put(fx.libraries, `${S}/Archives Sans Couverture/Chapitre 10.cbz`, zip({ '1.png': green }));
put(fx.libraries, `${S}/Archives Sans Couverture/Chapitre 1.cbz`, zip({ 'Tome/2.png': green, 'Tome/1.png': red, '__MACOSX/x.png': blue }));
put(fx.libraries, `${S}/Dossiers Sans Couverture/Chapitre 1/b.png`, green);
put(fx.libraries, `${S}/Dossiers Sans Couverture/Chapitre 1/a.png`, red);
put(fx.libraries, `${S}/Faux Couverture/cover.png`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
put(fx.libraries, `${S}/Faux Couverture/Chapitre 1.cbz`, zip({ '1.png': red }));
put(fx.libraries, `${S}/Hostile/Chapitre 01 traversee.cbz`, zip({ '1.png': red, '../evil.png': green }));
put(fx.libraries, `${S}/Hostile/Chapitre 02 chiffree.cbz`, zip({ '1.png': { data: red, flags: 1, raw: Buffer.concat([Buffer.alloc(12), red]) } }));
put(fx.libraries, `${S}/Hostile/Chapitre 03 compression.cbz`, zip({ '1.png': { data: red, method: 12, raw: red } }));
put(fx.libraries, `${S}/Hostile/Chapitre 04 tronquee.cbz`, zip({ '1.png': red, '2.png': green }).subarray(0, 150));
put(fx.libraries, `${S}/Hostile/Chapitre 05 svg.cbz`, zip({ '1.jpg': '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>' }));
put(fx.libraries, `${S}/Hostile/Chapitre 06 vide.cbz`, zip({ '1.png': Buffer.alloc(0) }));
put(fx.libraries, `${S}/Hostile/Chapitre 07 bombe.cbz`, zip({ '1.png': { data: filler(red, 20 * 1024 * 1024), method: 8 } }));
put(fx.libraries, `${S}/Hostile/Chapitre 08 trop grosse.cbz`, zip({ '1.png': { data: red, method: 8, csize: 100, usize: 70 * 1024 * 1024 } }));
put(fx.libraries, `${S}/Hostile/Chapitre 09 mensonge.cbz`, zip({ '1.png': { data: filler(red, 3000000), method: 8, usize: 30 } }));
put(fx.libraries, `${S}/Hostile/Chapitre 10 pas un zip.cbz`, 'pas du tout une archive');
put(fx.libraries, `${S}/Hostile/Chapitre 11 doublon.cbz`, zip([['1.png', red], ['1.png', green]]));
put(fx.libraries, `${S}/Hostile/Chapitre 12 sans page.cbz`, zip({ 'texte.txt': 'x' }));
put(fx.libraries, `${S}/Hostile/Chapitre 13 faux jpg.cbz`, zip({ '1.jpg': Buffer.from('<!doctype html><script>1</script>') }));
const bigImage = join(fx.libraries, S, 'Hostile/Chapitre 14 dossier/1.png');
put(fx.libraries, `${S}/Hostile/Chapitre 14 dossier/1.png`, red);
fs.truncateSync(bigImage, 64 * 1024 * 1024 + 1); // fichier creux : 64 Mo + 1 octet, l'image dépasse la limite
put(fx.libraries, `${S}/Hostile/Chapitre 15 dossier/1.png`, Buffer.alloc(0));
put(fx.libraries, `${S}/Hostile/Chapitre 16 dossier/1.png`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
// Grosse archive stockée : trois entrées de 40 Mo. Sert à vérifier que la lecture est en flux.
put(fx.libraries, `${S}/Gros Volume/Chapitre 1.cbz`, zip({ '1.png': filler(red, 40e6), '2.png': filler(green, 40e6), '3.png': filler(blue, 40e6) }));

const app = await boot(passwordEnv(fx));
const dataBefore = snapshot(fx.data); // secret.key et libraries.json existent depuis le démarrage
const cookie = (await post(app, '/api/v1/login', CREDENTIALS)).headers['set-cookie'][0].split(';')[0];
const api = (path, headers = {}) => get(app, path, { Cookie: cookie, ...headers });
const raw = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: app.port, path, headers: { Cookie: cookie, ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on('error', reject);
  }).on('error', reject);
});
const seriesByName = async (name) => (await api('/api/v1/series?search=' + encodeURIComponent(name))).json.content.find((s) => s.name === name);
const booksOf = async (name) => (await api(`/api/v1/series/${(await seriesByName(name)).id}/books`)).json.content;
let alltext = '';

test('folder chapter: pages in natural order, only direct visible images, exact bytes and headers', async () => {
  const [c1, c2] = await booksOf('Pages Dossier');
  const list = await api(`/api/v1/books/${c1.id}/pages`);
  alltext += list.text;
  assert.deepEqual(list.json, [1, 2, 3].map((number) => ({ number, mediaType: 'image/png' })));
  const bodies = [];
  for (const n of [1, 2, 3]) {
    const res = await raw(`/api/v1/books/${c1.id}/pages/${n}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['content-length'], String(res.body.length));
    bodies.push(res.body);
  }
  assert.deepEqual(bodies, [red, green, blue]); // 1, 2, 10 : l'ordre naturel, pas l'ordre alphabétique
  const jpg = await raw(`/api/v1/books/${c2.id}/pages/1`);
  assert.deepEqual([jpg.headers['content-type'], jpg.body.equals(jpeg)], ['image/jpeg', true]);
  assert.equal((await api(`/api/v1/books/${c1.id}/pages/4`)).status, 404);
});
test('archive chapter: nested folders flattened and sorted, noise ignored, pagesCount known after the first opening', async () => {
  const books = await booksOf('Archives Sans Couverture');
  assert.deepEqual(books.map((b) => b.name), ['Chapitre 1', 'Chapitre 2', 'Chapitre 10']);
  assert.ok(books.every((b) => b.media.pagesCount === null)); // pas encore ouvertes
  const list = await api(`/api/v1/books/${books[0].id}/pages`);
  assert.equal(list.json.length, 2);
  assert.deepEqual((await raw(`/api/v1/books/${books[0].id}/pages/1`)).body, red);
  assert.deepEqual((await raw(`/api/v1/books/${books[0].id}/pages/2`)).body, green);
  const again = await booksOf('Archives Sans Couverture');
  assert.deepEqual(again.map((b) => b.media.pagesCount), [2, null, null]);
  assert.equal((await api(`/api/v1/books/${books[0].id}`)).json.media.pagesCount, 2);
  assert.equal((await raw(`/api/v1/books/${books[1].id}/pages/1`)).status, 200); // ouvrir sans lister suffit aussi
  assert.equal((await booksOf('Archives Sans Couverture'))[1].media.pagesCount, 1);
});
test('security headers on images: nosniff, sandbox CSP, same-origin resource policy, revalidation required', async () => {
  const [c1] = await booksOf('Pages Dossier');
  const res = await raw(`/api/v1/books/${c1.id}/pages/1`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(res.headers['cache-control'], 'private, no-cache');
  assert.match(res.headers.etag, /^"[0-9a-f]{24}"$/);
  assert.match(res.headers['last-modified'], /GMT$/);
});
test('page numbers outside 1..N or malformed: 404, no filesystem path in the body', async () => {
  const [c1] = await booksOf('Pages Dossier');
  for (const n of ['0', '4', '-1', '01', 'abc', '1.5', '9999999', '1%2f..%2f2', '%2e%2e']) {
    const res = await api(`/api/v1/books/${c1.id}/pages/${n}`);
    assert.equal(res.status, 404, n);
    assert.ok(!res.text.includes(fx.root));
  }
  assert.equal((await api(`/api/v1/books/${c1.id}/pages/1/extra`)).status, 404);
});
test('the pages and covers need a session in password mode', async () => {
  const [c1] = await booksOf('Pages Dossier');
  assert.equal((await get(app, `/api/v1/books/${c1.id}/pages/1`)).status, 401);
  assert.equal((await get(app, `/api/v1/books/${c1.id}/pages`)).status, 401);
  assert.equal((await get(app, `/api/v1/series/${c1.seriesId}/thumbnail`)).status, 401);
  assert.equal((await get(app, `/api/v1/books/${c1.id}/thumbnail`)).status, 401);
});

test('revalidation: 304 with If-None-Match (exact, weak, list, *), 304 with If-Modified-Since, 200 otherwise', async () => {
  const [c1] = await booksOf('Pages Dossier');
  const url = `/api/v1/books/${c1.id}/pages/1`;
  const first = await raw(url);
  const { etag } = first.headers;
  const lastModified = first.headers['last-modified'];
  for (const header of [etag, `W/${etag}`, `"autre", ${etag}`, '*']) {
    const res = await raw(url, { 'If-None-Match': header });
    assert.equal(res.status, 304, header);
    assert.equal(res.body.length, 0);
    assert.deepEqual([res.headers.etag, res.headers['cache-control'], res.headers['last-modified']], [etag, 'private, no-cache', lastModified]);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-type'], undefined);
  }
  assert.equal((await raw(url, { 'If-None-Match': '"autre"' })).status, 200);
  assert.equal((await raw(url, { 'If-Modified-Since': lastModified })).status, 304);
  assert.equal((await raw(url, { 'If-Modified-Since': new Date(Date.parse(lastModified) - 5000).toUTCString() })).status, 200);
  assert.equal((await raw(url, { 'If-Modified-Since': 'pas une date' })).status, 200);
  // If-None-Match l'emporte sur If-Modified-Since.
  assert.equal((await raw(url, { 'If-None-Match': '"autre"', 'If-Modified-Since': lastModified })).status, 200);
});
test('revalidation of an archive page: same ETag until the archive changes, different ETag per page', async () => {
  const books = await booksOf('Archives Sans Couverture');
  const a = await raw(`/api/v1/books/${books[0].id}/pages/1`);
  const b = await raw(`/api/v1/books/${books[0].id}/pages/2`);
  assert.notEqual(a.headers.etag, b.headers.etag);
  assert.equal((await raw(`/api/v1/books/${books[0].id}/pages/1`, { 'If-None-Match': a.headers.etag })).status, 304);
  assert.equal((await raw(`/api/v1/books/${books[0].id}/pages/2`, { 'If-None-Match': a.headers.etag })).status, 200);
});
test('Range requests are not supported: the full image is sent', async () => {
  const [c1] = await booksOf('Pages Dossier');
  const res = await raw(`/api/v1/books/${c1.id}/pages/1`, { Range: 'bytes=0-3' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.length, res.headers['content-range'], res.headers['accept-ranges']], [red.length, undefined, undefined]);
});

test('covers: cover.* of the series, else the first page of the first chapter; a chapter shares its series cover', async () => {
  const folder = await seriesByName('Pages Dossier');
  const withFile = await raw(`/api/v1/series/${folder.id}/thumbnail`);
  assert.deepEqual([withFile.status, withFile.headers['content-type'], withFile.body.equals(jpeg)], [200, 'image/jpeg', true]);
  const [c1] = await booksOf('Pages Dossier');
  const viaBook = await raw(`/api/v1/books/${c1.id}/thumbnail`);
  assert.deepEqual([viaBook.status, viaBook.body.equals(jpeg), viaBook.headers.etag], [200, true, withFile.headers.etag]);
  assert.equal((await raw(`/api/v1/series/${folder.id}/thumbnail`, { 'If-None-Match': withFile.headers.etag })).status, 304);
});
test('cover of a series of archives without cover file: first page of the first chapter in reading order', async () => {
  const s = await seriesByName('Archives Sans Couverture');
  const res = await raw(`/api/v1/series/${s.id}/thumbnail`);
  assert.deepEqual([res.status, res.headers['content-type']], [200, 'image/png']);
  assert.deepEqual(res.body, red); // Chapitre 1 (pas 10), page Tome/1.png
  const alpha = await seriesByName('Alpha Quest'); // celle de la bibliothèque d'essai a un cover.png
  assert.equal((await raw(`/api/v1/series/${alpha.id}/thumbnail`)).body.equals(readFileSync(join(fx.libraries, S, 'Alpha Quest/cover.png'))), true);
  const solo = await seriesByName('Solo Story'); // archive à la racine de la bibliothèque
  assert.equal((await raw(`/api/v1/series/${solo.id}/thumbnail`)).status, 200);
});
test('cover of a series of image folders without cover file: first page of the first chapter', async () => {
  const s = await seriesByName('Dossiers Sans Couverture');
  assert.deepEqual((await raw(`/api/v1/series/${s.id}/thumbnail`)).body, red); // a.png avant b.png
});
test('a cover.* that is not an image (SVG) is refused with 415, not served', async () => {
  const s = await seriesByName('Faux Couverture');
  const res = await raw(`/api/v1/series/${s.id}/thumbnail`);
  assert.equal(res.status, 415);
  assert.ok(!res.body.toString().includes('svg'));
});
test('unknown cover identifiers: 404', async () => {
  for (const p of ['/api/v1/series/0123456789abcdef/thumbnail', '/api/v1/books/0123456789abcdef.0123456789abcdef/thumbnail', '/api/v1/series/..%2f/thumbnail']) assert.equal((await api(p)).status, 404, p);
});

test('hostile archives: each gets its readable status (422, 413, 415), nothing leaks, the service keeps answering', async () => {
  const books = await booksOf('Hostile');
  const byName = Object.fromEntries(books.map((b) => [b.name.slice(12), b]));
  const expect = {
    traversee: [422, 'archive invalid'], chiffree: [422, 'archive encrypted'], compression: [422, 'archive uses an unsupported feature (compression method or multi-volume)'],
    tronquee: [422, 'archive truncated or corrupt'], svg: [415, 'unsupported media type'], vide: [415, 'unsupported media type'],
    bombe: [413, 'image compression ratio too high'], 'trop grosse': [413, 'image too large'], mensonge: [422, 'archive invalid'],
    'pas un zip': [422, 'archive invalid'], doublon: [422, 'archive invalid'], 'faux jpg': [415, 'unsupported media type'],
    'dossier': null,
  };
  for (const [key, want] of Object.entries(expect)) {
    if (!want) continue;
    const book = byName[key];
    assert.ok(book, key);
    const res = await raw(`/api/v1/books/${book.id}/pages/1`);
    alltext += res.body.toString();
    assert.deepEqual([res.status, JSON.parse(res.body).error], want, key);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  }
  // Les listes de pages des archives refusées au listing le sont aussi.
  for (const key of ['traversee', 'chiffree', 'compression', 'tronquee', 'pas un zip', 'doublon']) assert.equal((await api(`/api/v1/books/${byName[key].id}/pages`)).status, 422, key);
  const empty = await api(`/api/v1/books/${byName['sans page'].id}/pages`);
  assert.deepEqual([empty.status, empty.json], [200, []]);
  assert.equal((await api(`/api/v1/books/${byName['sans page'].id}/pages/1`)).status, 404);
  assert.equal((await api('/api/v1/libraries')).status, 200);
});
test('hostile image folders: 64 MiB + 1 byte, 0 byte and SVG named .png are refused (413, 415, 415)', async () => {
  const books = await booksOf('Hostile');
  const dirs = books.filter((b) => b.media.mediaType === 'inode/directory');
  assert.equal(dirs.length, 3);
  assert.deepEqual((await Promise.all(dirs.map((b) => api(`/api/v1/books/${b.id}/pages/1`)))).map((r) => r.status), [413, 415, 415]);
});
test('a lying central directory (small announced size, big real content) is cut off, not served', async () => {
  const mensonge = (await booksOf('Hostile')).find((b) => b.name.includes('mensonge'));
  const res = await raw(`/api/v1/books/${mensonge.id}/pages/1`);
  assert.equal(res.status, 422);
  assert.ok(res.body.length < 100); // jamais les 3 Mo
});

test('large stored archive: the page is streamed, with backpressure; the other entries and the archive are not read', async () => {
  const [book] = await booksOf('Gros Volume');
  let requested = 0;
  const original = fs.read;
  fs.read = function (fd, buffer, offset, length, position, callback) { requested += length; return original.call(this, fd, buffer, offset, length, position, callback); };
  try {
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: app.port, path: `/api/v1/books/${book.id}/pages/2`, headers: { Cookie: cookie } }, resolve).on('error', reject);
    });
    res.pause(); // client à l'arrêt : le serveur doit s'arrêter de lire quand les tampons sont pleins
    assert.equal(res.headers['content-length'], String(40e6));
    await sleep(700);
    const whileStalled = requested;
    assert.ok(whileStalled < 24e6, `${whileStalled} octets lus alors que le client ne lit pas`); // page : 40 Mo, archive : 120 Mo
    let received = 0;
    let head;
    res.on('data', (c) => { if (!head) head = c.subarray(0, 8); received += c.length; });
    res.resume();
    await new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); });
    assert.equal(received, 40e6);
    assert.deepEqual(head, green.subarray(0, 8));
    assert.ok(requested < 40e6 + 1e6, `${requested} octets lus pour une page de 40 Mo dans une archive de 120 Mo`);
  } finally { fs.read = original; }
});
test('a client that disconnects mid-stream releases the file (no descriptor left, the service keeps answering)', async () => {
  const [book] = await booksOf('Gros Volume');
  const before = openFds();
  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: app.port, path: `/api/v1/books/${book.id}/pages/3`, headers: { Cookie: cookie } }, (res) => {
      res.once('data', () => { req.destroy(); resolve(); });
    });
    req.on('error', () => {});
    setTimeout(() => reject(new Error('pas de données')), 5000);
  });
  await sleep(300);
  if (before !== null) assert.ok(openFds() <= before + 1, `${openFds() - before} descripteurs de plus`);
  assert.equal((await api('/api/v1/libraries')).status, 200);
});

test('nothing is written: the data directory and the temporary directory are unchanged after reading everything', async () => {
  const tmpBefore = fs.readdirSync(tmpdir()).sort().join();
  const fdsBefore = openFds();
  const series = (await api('/api/v1/series?size=100')).json.content;
  for (const s of series) {
    await api(`/api/v1/series/${s.id}/thumbnail`);
    for (const b of (await api(`/api/v1/series/${s.id}/books`)).json.content) {
      const list = await api(`/api/v1/books/${b.id}/pages`);
      for (const p of list.json?.slice?.(0, 3) ?? []) await raw(`/api/v1/books/${b.id}/pages/${p.number}`);
    }
  }
  assert.equal(fs.readdirSync(tmpdir()).sort().join(), tmpBefore);
  assert.equal(snapshot(fx.data), dataBefore);
  if (fdsBefore !== null) assert.ok(openFds() - fdsBefore <= 16, 'descripteurs ouverts bornés par le cache d\'archives');
});
test('an unmounted library answers 503 on pages and covers, never 404', async () => {
  const [c1] = await booksOf('Pages Dossier');
  renameSync(join(fx.libraries, S), join(fx.root, 'demonte'));
  try {
    for (const p of [`/api/v1/books/${c1.id}/pages`, `/api/v1/books/${c1.id}/pages/1`, `/api/v1/series/${c1.seriesId}/thumbnail`, `/api/v1/books/${c1.id}/thumbnail`]) {
      const res = await api(p);
      assert.equal(res.status, 503, p);
      assert.equal(res.headers['retry-after'], '5');
    }
  } finally { renameSync(join(fx.root, 'demonte'), join(fx.libraries, S)); }
  assert.equal((await api(`/api/v1/books/${c1.id}/pages/1`)).status, 200);
});
test('no response mentions a filesystem path', () => {
  assert.ok(!alltext.includes(fx.root) && !alltext.includes('/libraries') && !alltext.includes(tmpdir()));
});

try { await run(); } finally { await app.close(); }
