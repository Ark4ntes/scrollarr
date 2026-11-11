// Invalidation (READ-002 §4.8), en HTTP : un test par ligne du tableau des événements, puis un test
// par règle de vérification (qui est relu, quand, avec quelle profondeur).
// Les délais de 60 s et 30 s de la production sont ramenés à quelques centaines de millisecondes.
// Lancer avec : node tests/integration_folders_invalidation.mjs
import assert from 'node:assert/strict';
import fs, { rmSync, renameSync, utimesSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { suite, fixture, env, boot, get, post, put, sleep, openFds } from './_folders.mjs';
import { png, zip } from '../dev/make-folders-fixture.mjs';

const { test, run } = suite('folders invalidation');
const HOUR = 3600e3;
const TTL = 250;
const red = png(200, 0, 0), green = png(0, 200, 0), blue = png(0, 0, 200);
const S = 'Scans';
const apps = [];
/** Remet à `file` les dates de `reference`, à la nanoseconde (comme `cp -p`, `rsync -t`, `touch -r`) : utimes() de Node les arrondit. */
const sameDates = (reference, file) => execFileSync('touch', ['-r', reference, file]);

/** Service sur une bibliothèque d'essai. `ttl` : délais de relecture (ms) ; `fresh` : tout relire à chaque requête. */
async function setup({ listTtlMs = 0, seriesTtlMs = 0, ...more } = {}) {
  const fx = fixture();
  const app = await boot(env({}, fx), { listTtlMs, seriesTtlMs, ...more });
  apps.push(app);
  const api = (path, headers) => get(app, path, headers);
  const series = async (name) => (await api('/api/v1/series?search=' + encodeURIComponent(name))).json.content.find((s) => s.name === name);
  const books = async (name) => (await api(`/api/v1/series/${(await series(name)).id}/books`)).json.content;
  const settle = async () => { for (let i = 0; i < 200; i++) { if (!(await api('/api/v1/scan')).json.running) return; await sleep(10); } };
  const rescan = async () => { await post(app, '/api/v1/scan'); await sleep(20); await settle(); };
  return { fx, app, api, series, books, settle, rescan, path: (rel) => join(fx.libraries, S, rel) };
}

// ── Tableau des événements ──
test('event: chapter or series added — seen at the next relisting of its level (not before)', async () => {
  const t = await setup({ listTtlMs: TTL, seriesTtlMs: TTL });
  const titles = async () => (await t.api('/api/v1/series?size=100')).json.content.map((s) => s.name);
  const gamma = await t.series('Gamma Tomes');
  const count = async () => (await t.api(`/api/v1/series/${gamma.id}/books`)).json.content.length;
  assert.equal(await count(), 4);
  put(t.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 012.cbz`, zip({ '1.png': red })); // ajout profond
  put(t.fx.libraries, `${S}/Nouvelle Serie/Chapitre 1.cbz`, zip({ '1.png': red }));
  assert.equal(await count(), 4); // délai pas écoulé : on ne relit pas
  assert.ok(!(await titles()).includes('Nouvelle Serie'));
  await sleep(TTL + 50);
  assert.equal(await count(), 5);
  assert.ok((await titles()).includes('Nouvelle Serie'));
  assert.equal((await t.books('Nouvelle Serie')).length, 1);
});
test('event: deleted — 404 at the next relisting; the same path coming back gives the same identifiers again', async () => {
  const t = await setup();
  const [c1] = await t.books('Beta Folders');
  const sid = c1.seriesId;
  const before = (await t.api(`/api/v1/books/${c1.id}/pages`)).json.length;
  const stash = join(t.fx.root, 'corbeille');
  renameSync(t.path('Beta Folders/Chapitre 1'), stash);
  assert.equal((await t.api(`/api/v1/books/${c1.id}`)).status, 404);
  assert.equal((await t.api(`/api/v1/books/${c1.id}/pages`)).status, 404);
  assert.equal((await t.api(`/api/v1/books/${c1.id}/pages/1`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${sid}/books`)).json.content.length, 2);
  renameSync(stash, t.path('Beta Folders/Chapitre 1')); // la progression (étape C) est liée à l'identifiant : il redevient valide
  assert.equal((await t.api(`/api/v1/books/${c1.id}/pages`)).json.length, before);
  rmSync(t.path('Beta Folders'), { recursive: true });
  assert.equal((await t.api(`/api/v1/series/${sid}`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${sid}/thumbnail`)).status, 404);
});
test('event: renamed or moved — the old identifier disappears (404), a new one appears', async () => {
  const t = await setup();
  const gamma = (await t.books('Gamma Tomes'));
  const old = gamma[0]; // Tome 01 / Chapitre 001
  renameSync(t.path('Gamma Tomes/Tome 01/Chapitre 001.cbz'), t.path('Gamma Tomes/Tome 02/Chapitre 001.cbz')); // déplacé
  assert.equal((await t.api(`/api/v1/books/${old.id}`)).status, 404);
  assert.equal((await t.api(`/api/v1/books/${old.id}/pages/1`)).status, 404);
  const after = await t.books('Gamma Tomes');
  assert.equal(after.length, 4);
  assert.ok(after.every((b) => b.id !== old.id));
  const moved = after.find((b) => b.metadata.title === 'Tome 02 / Chapitre 001');
  assert.equal((await t.api(`/api/v1/books/${moved.id}/pages/1`)).status, 200);
  const beta = await t.series('Beta Folders');
  renameSync(t.path('Beta Folders'), t.path('Beta Renamed')); // série renommée
  assert.equal((await t.api(`/api/v1/series/${beta.id}`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${beta.id}/thumbnail`)).status, 404);
  const renamed = await t.series('Beta Renamed');
  assert.notEqual(renamed.id, beta.id);
  assert.equal((await t.api(`/api/v1/series/${renamed.id}/thumbnail`)).status, 200);
});
test('event: file replaced — detected on the next request even with the same size and the same date; pages change ETag', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR }); // la série n'est pas relue : seule la vérification par requête joue
  const [a] = await t.books('Alpha Quest');
  const url = `/api/v1/books/${a.id}/pages/1`;
  const file = t.path('Alpha Quest/Chapitre 001.cbz');
  const first = await t.api(url);
  const original = statSync(file);
  writeFileSync(file + '.ref', ''); sameDates(file, file + '.ref');
  // (a) remplacement par un autre fichier de même taille, date de modification restaurée : nouvel inode
  const same = zip({ '001.png': green, '002.png': green, '003.png': green });
  assert.equal(same.length, original.size);
  writeFileSync(file + '.nouveau', same);
  sameDates(file + '.ref', file + '.nouveau');
  renameSync(file + '.nouveau', file);
  assert.equal(statSync(file).mtimeMs, original.mtimeMs);
  assert.equal((await t.api(url, { 'If-None-Match': first.headers.etag })).status, 200); // plus de 304
  const second = await t.api(url);
  assert.notEqual(second.headers.etag, first.headers.etag);
  assert.equal(second.headers['content-length'], String(green.length));
  // (b) réécriture sur place, même taille, date restaurée : seul ctime a changé
  const fd = fs.openSync(file, 'r+'); fs.writeSync(fd, zip({ '001.png': blue, '002.png': blue, '003.png': blue })); fs.closeSync(fd);
  sameDates(file + '.ref', file);
  assert.equal(statSync(file).mtimeMs, original.mtimeMs);
  assert.equal(statSync(file).size, original.size);
  const third = await t.api(url);
  assert.notEqual(third.headers.etag, second.headers.etag);
  assert.equal((await fs.promises.readFile(file)).includes(blue), true);
  assert.equal(third.status, 200);
  // (c) archive remplacée par une autre qui a moins de pages : la liste suit tout de suite
  writeFileSync(file, zip({ '1.png': red }));
  assert.equal((await t.api(`/api/v1/books/${a.id}/pages`)).json.length, 1);
  assert.equal((await t.api(`/api/v1/books/${a.id}/pages/2`)).status, 404);
  // (d) image d'un dossier remplacée
  const [b] = await t.books('Beta Folders');
  const img = t.path('Beta Folders/Chapitre 1/001.png');
  const imgUrl = `/api/v1/books/${b.id}/pages/1`;
  const e1 = (await t.api(imgUrl)).headers.etag;
  const stat = statSync(img);
  writeFileSync(img + '.n', Buffer.concat([green, Buffer.alloc(0)]).subarray(0, stat.size));
  sameDates(img, img + '.n');
  renameSync(img + '.n', img);
  assert.notEqual((await t.api(imgUrl)).headers.etag, e1);
});
test('event: file gone between the list and the opening — 404, and the series is read again right away', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR });
  const books = await t.books('Alpha Quest');
  const sid = books[0].seriesId;
  rmSync(t.path('Alpha Quest/Chapitre 002.cbz'));
  // Sans relecture, le délai d'une heure ferait encore voir le chapitre ; la requête qui échoue la déclenche.
  assert.equal((await t.api(`/api/v1/series/${sid}/books`)).json.content.length, 3);
  assert.equal((await t.api(`/api/v1/books/${books[1].id}/pages/1`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${sid}/books`)).json.content.length, 2);
  // Même chose pour une image de dossier et pour le fichier de couverture.
  const beta = await t.books('Beta Folders');
  rmSync(t.path('Beta Folders/Chapitre 2'), { recursive: true });
  assert.equal((await t.api(`/api/v1/books/${beta[1].id}/pages/1`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${beta[0].seriesId}/books`)).json.content.length, 2);
  const delta = await t.series('Delta Oneshot');
  rmSync(t.path('Delta Oneshot/cover.jpg'));
  assert.equal((await t.api(`/api/v1/series/${delta.id}/thumbnail`)).status, 404);
  assert.equal((await t.api(`/api/v1/series/${delta.id}/thumbnail`)).status, 200); // série relue : plus de cover.jpg, première page à la place
});
test('event: chapter count in the grid — may date from the last full scan or the last opening of the series', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: 0 });
  const count = async () => (await t.api('/api/v1/series?search=Alpha')).json.content[0].booksCount;
  const alpha = await t.series('Alpha Quest');
  assert.equal(await count(), 3);
  put(t.fx.libraries, `${S}/Alpha Quest/Chapitre 020.cbz`, zip({ '1.png': red }));
  assert.equal(await count(), 3); // la grille ne relit pas les séries
  assert.equal((await t.api(`/api/v1/series/${alpha.id}`)).json.booksCount, 4); // ouvrir la série la relit
  assert.equal(await count(), 4);
  put(t.fx.libraries, `${S}/Alpha Quest/Chapitre 021.cbz`, zip({ '1.png': red }));
  assert.equal(await count(), 4);
  await t.rescan(); // un parcours complet la met aussi à jour
  assert.equal(await count(), 5);
});
test('event: library unreadable, or empty after having held series — 503 on lists, series, books, pages and covers, until readable or confirmed by POST /scan', async () => {
  const t = await setup();
  const [c1] = await t.books('Omega');
  const sid = c1.seriesId;
  const lib = (await t.api('/api/v1/libraries')).json.find((l) => l.name === 'Autre').id;
  const urls = [`/api/v1/series?library=${lib}`, `/api/v1/series/${sid}`, `/api/v1/series/${sid}/books`, `/api/v1/books/${c1.id}`, `/api/v1/books/${c1.id}/pages`, `/api/v1/books/${c1.id}/pages/1`, `/api/v1/series/${sid}/thumbnail`, `/api/v1/books/${c1.id}/thumbnail`];
  const all = async (status) => { for (const u of urls) assert.equal((await t.api(u)).status, status, u); };
  await all(200);
  // Dossier partagé verrouillé ou non monté : la bibliothèque paraît vide.
  renameSync(join(t.fx.libraries, 'Autre/Omega'), join(t.fx.root, 'Omega-ailleurs'));
  await all(503);
  assert.equal((await t.api('/api/v1/series/0123456789abcdef')).status, 503); // identifiant inconnu mais indécidable : jamais 404
  assert.equal((await t.api('/api/v1/series?library=' + (await t.api('/api/v1/libraries')).json.find((l) => l.name === 'Scans').id)).status, 200);
  await t.rescan(); // POST /scan confirme que la bibliothèque est vraiment vide
  assert.deepEqual((await t.api(`/api/v1/series?library=${lib}`)).json.content, []);
  for (const u of urls.slice(1)) assert.equal((await t.api(u)).status, 404, u);
  renameSync(join(t.fx.root, 'Omega-ailleurs'), join(t.fx.libraries, 'Autre/Omega')); // elle redevient lisible
  await all(200);
});
test('event: library unreadable (root gone) — 503, back to 200 when it is mounted again', async () => {
  const t = await setup();
  const [c1] = await t.books('Omega');
  renameSync(join(t.fx.libraries, 'Autre'), join(t.fx.root, 'demonte'));
  for (const u of [`/api/v1/books/${c1.id}/pages`, `/api/v1/books/${c1.id}/pages/1`, `/api/v1/series/${c1.seriesId}/thumbnail`]) assert.equal((await t.api(u)).status, 503, u);
  const scans = (await t.api('/api/v1/libraries')).json.find((l) => l.name === 'Scans').id;
  assert.equal((await t.api(`/api/v1/series?library=${scans}&search=Alpha`)).status, 200); // l'autre bibliothèque reste lisible
  renameSync(join(t.fx.root, 'demonte'), join(t.fx.libraries, 'Autre'));
  assert.equal((await t.api(`/api/v1/books/${c1.id}/pages/1`)).status, 200);
});

// ── Règles de vérification : qui est relu, quand, et à quelle profondeur ──
test('rule: pages of an image folder are read again at every request (an image added or renamed is seen at once)', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR });
  const [c1] = await t.books('Beta Folders');
  const pages = async () => (await t.api(`/api/v1/books/${c1.id}/pages`)).json.length;
  const n = await pages();
  put(t.fx.libraries, `${S}/Beta Folders/Chapitre 1/099.png`, red);
  assert.equal(await pages(), n + 1);
  assert.deepEqual((await t.api(`/api/v1/books/${c1.id}/pages/${n + 1}`)).headers['content-length'], String(red.length));
  rmSync(t.path('Beta Folders/Chapitre 1/099.png'));
  assert.equal(await pages(), n);
});
test('rule: an archive is checked at every request with inode, size, mtime and ctime — a mode change alone (ctime) discards the list', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR });
  const [a] = await t.books('Alpha Quest');
  const url = `/api/v1/books/${a.id}/pages/1`;
  const e0 = (await t.api(url)).headers.etag;
  assert.equal((await t.api(url)).headers.etag, e0); // rien n'a changé : même validateur
  const file = t.path('Alpha Quest/Chapitre 001.cbz');
  const st = statSync(file);
  chmodSync(file, 0o600); // ni la taille ni la date de modification ne bougent
  assert.equal(statSync(file).mtimeMs, st.mtimeMs);
  assert.notEqual((await t.api(url)).headers.etag, e0);
  const e1 = (await t.api(url)).headers.etag;
  utimesSync(file, st.atime, new Date(st.mtimeMs + 60000)); // date de modification seule
  assert.notEqual((await t.api(url)).headers.etag, e1);
});
test('rule: a deep change (3 levels under the series) is seen by the next opening of the series, whatever the folder dates say', async () => {
  const t = await setup({ seriesTtlMs: 0 });
  const gamma = await t.series('Gamma Tomes');
  const dir = t.path('Gamma Tomes/Tome 02');
  const before = statSync(dir);
  put(t.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 010/099.png`, red); // sous un chapitre-dossier : la date de « Tome 02 » ne bouge pas
  const parent = statSync(t.path('Gamma Tomes'));
  utimesSync(dir, before.atime, before.mtime); utimesSync(t.path('Gamma Tomes/Tome 02/Chapitre 010'), before.atime, before.mtime);
  utimesSync(t.path('Gamma Tomes'), parent.atime, parent.mtime);
  put(t.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 013.cbz`, zip({ '1.png': red }));
  utimesSync(dir, before.atime, before.mtime); utimesSync(t.path('Gamma Tomes'), parent.atime, parent.mtime);
  const list = (await t.api(`/api/v1/series/${gamma.id}/books`)).json.content;
  assert.ok(list.some((b) => b.name === 'Chapitre 013'));
});
test('rule: POST /scan refreshes everything, including series whose delay has not expired', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR });
  const gamma = await t.series('Gamma Tomes');
  put(t.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 013.cbz`, zip({ '1.png': red }));
  put(t.fx.libraries, `${S}/Autre Nouvelle/Chapitre 1.cbz`, zip({ '1.png': red }));
  assert.equal((await t.api(`/api/v1/series/${gamma.id}/books`)).json.content.length, 4);
  assert.equal((await t.api('/api/v1/series?search=Autre%20Nouvelle')).json.content.length, 0);
  const started = await post(t.app, '/api/v1/scan');
  assert.equal(started.status, 202);
  await sleep(20); await t.settle();
  assert.equal((await t.api(`/api/v1/series/${gamma.id}/books`)).json.content.length, 5);
  assert.equal((await t.api('/api/v1/series?search=Autre%20Nouvelle')).json.content.length, 1);
});
test('rule: a full scan runs in the background when someone opens a library and the last one is older than the delay; never when the delay is 0', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR, rescanMinutes: 0.002 }); // 120 ms
  const gamma = await t.series('Gamma Tomes');
  put(t.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 013.cbz`, zip({ '1.png': red }));
  await t.api('/api/v1/series'); // trop tôt
  await t.settle();
  assert.equal((await t.api(`/api/v1/series/${gamma.id}/books`)).json.content.length, 4);
  await sleep(200);
  await t.api('/api/v1/series'); // ouverture de la bibliothèque : le parcours part
  await sleep(50); await t.settle();
  assert.equal((await t.api(`/api/v1/series/${gamma.id}/books`)).json.content.length, 5);
  const never = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR, rescanMinutes: 0 });
  const g2 = await never.series('Gamma Tomes');
  put(never.fx.libraries, `${S}/Gamma Tomes/Tome 02/Chapitre 013.cbz`, zip({ '1.png': red }));
  await sleep(200); await never.api('/api/v1/series'); await sleep(50); await never.settle();
  assert.equal((await never.api(`/api/v1/series/${g2.id}/books`)).json.content.length, 4);
});
test('rule: a full scan throws away every archive list (descriptors closed), the next request reads the archive again', async () => {
  const t = await setup({ listTtlMs: HOUR, seriesTtlMs: HOUR });
  const before = openFds();
  for (const name of ['Alpha Quest', 'Gamma Tomes', 'Solo Story']) for (const b of await t.books(name)) if (b.media.mediaType === 'application/zip') await t.api(`/api/v1/books/${b.id}/pages/1`);
  const open = openFds();
  await t.rescan();
  await sleep(50);
  if (before !== null) { assert.ok(open - before >= 6, `${open - before} archives ouvertes`); assert.ok(open - openFds() >= 6, `parcours complet : ${open - openFds()} descripteurs fermés`); }
  const [a] = await t.books('Alpha Quest');
  assert.equal((await t.api(`/api/v1/books/${a.id}/pages/1`)).status, 200);
});
test('rule: the service reads the tree at startup (first scan) and keeps no cache on disk', async () => {
  const t = await setup();
  assert.equal((await t.api('/api/v1/scan')).json.series, 7);
  assert.deepEqual(fs.readdirSync(t.fx.data).sort(), ['libraries.json', 'secret.key']);
});

run();
