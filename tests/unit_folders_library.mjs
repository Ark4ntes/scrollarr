// Index des bibliothèques : structure, invalidation, états « indisponible ».
// Lancer avec : node tests/unit_folders_library.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, renameSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { suite, fixture, tmp, quiet } from './_folders.mjs';
import { findLibraries } from '../folders/config.js';
import { createFlags } from '../folders/store.js';
import { createLibraries, Unavailable, NotFound } from '../folders/library.js';
import { png, zip } from '../dev/make-folders-fixture.mjs';

const { test, run } = suite('folders library');
const CONFIG = { listTtlMs: 0, seriesTtlMs: 0, retryMs: 0, rescanMinutes: 0 };

async function open(fx, flags) {
  const mounts = await findLibraries(fx.libraries);
  flags ??= await createFlags(fx.data).load();
  mkdirSync(fx.data, { recursive: true });
  const libs = createLibraries({ config: CONFIG, mounts, flags, log: quiet });
  await libs.start();
  return libs;
}
const titles = async (libs, library) => (await libs.listSeries({ library })).content.map(({ s }) => s.title);
const idOf = async (libs, title) => (await libs.listSeries({ search: title })).content[0].s.id;
const lib = (libs, name) => libs.libraries().find((l) => l.name === name).id;

test('structure of the fixture: series, order, unavailable states are clean', async () => {
  const libs = await open(fixture());
  assert.deepEqual(libs.libraries().map((l) => l.name), ['Autre', 'Scans']);
  assert.deepEqual(await titles(libs, lib(libs, 'Scans')), ['Alpha Quest', 'Beta Folders', 'Delta Oneshot', 'Epsilon Mixte', 'Gamma Tomes', 'Solo Story']);
  assert.deepEqual(await titles(libs, lib(libs, 'Autre')), ['Omega']);
  assert.deepEqual(libs.health().map((l) => l.state), ['ok', 'ok']);
});
test('chapters: natural reading order, folders and archives, numbers', async () => {
  const libs = await open(fixture());
  const beta = await libs.getSeries(await idOf(libs, 'Beta'));
  assert.deepEqual(beta.series.chapters.map((c) => c.name), ['Chapitre 1', 'Chapitre 2', 'Chapitre 10']);
  assert.ok(beta.series.chapters.every((c) => c.kind === 'dir' && c.pages >= 2));
  assert.deepEqual(beta.series.chapters.map((c) => c.numberSort), [1, 2, 10]);
  const gamma = (await libs.getSeries(await idOf(libs, 'Gamma'))).series;
  assert.deepEqual(gamma.chapters.map((c) => c.title), ['Tome 01 / Chapitre 001', 'Tome 01 / Chapitre 002.5', 'Tome 02 / Chapitre 010', 'Tome 02 / [Equipe] Chapitre 011']);
  assert.deepEqual(gamma.chapters.map((c) => c.numberSort), [1, 2.5, 10, 11]);
  assert.deepEqual(gamma.chapters.map((c) => c.kind), ['archive', 'archive', 'dir', 'archive']);
});
test('messy trees: loose images become one chapter, mixed trees warn, root archive is a series', async () => {
  const libs = await open(fixture());
  const delta = (await libs.getSeries(await idOf(libs, 'Delta'))).series;
  assert.equal(delta.chapters.length, 1);
  assert.equal(delta.chapters[0].name, 'Delta Oneshot');
  assert.equal(delta.chapters[0].pages, 4); // cover.jpg n'est pas une page
  const eps = (await libs.getSeries(await idOf(libs, 'Epsilon'))).series;
  assert.equal(eps.chapters.length, 1);
  assert.ok(libs.status().warnings.some((w) => w.code === 'loose-images' && w.series === 'Epsilon Mixte'));
  const solo = (await libs.getSeries(await idOf(libs, 'Solo'))).series;
  assert.deepEqual([solo.kind, solo.chapters.length, solo.chapters[0].kind], ['archive', 1, 'archive']);
});
test('warnings: empty folder, empty archive, too deep, symlinks; ignored names stay silent', async () => {
  const libs = await open(fixture());
  const codes = libs.status().warnings.map((w) => `${w.code}:${w.entry}`);
  for (const expected of ['no-chapters:Vide', 'empty-archive:Chapitre 1.cbz', 'too-deep:d', 'symlink:Lien vers dehors', 'symlink:Lien']) assert.ok(codes.includes(expected), expected);
  for (const silent of ['@eaDir', '.cache', 'Thumbs.db', '__MACOSX']) assert.ok(!codes.some((c) => c.includes(silent)), silent);
  const titlesAll = await titles(libs);
  assert.ok(!titlesAll.includes('Lien vers dehors') && !titlesAll.includes('Intrus'));
});
test('no response object carries a filesystem path', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const dump = JSON.stringify([libs.status(), (await libs.listSeries({})).content.map(({ s }) => ({ ...s, byId: undefined }))]);
  assert.ok(!dump.includes(fx.root) && !dump.includes(fx.libraries));
});

test('deep addition, rename and deletion are seen at the next listing', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const sid = await idOf(libs, 'Gamma');
  const before = (await libs.getSeries(sid)).series.chapters.length;
  writeFileSync(join(fx.libraries, 'Scans/Gamma Tomes/Tome 02/Chapitre 012.cbz'), zip({ '001.png': png() }));
  assert.equal((await libs.getSeries(sid)).series.chapters.length, before + 1);
  const bid = (await libs.getSeries(sid)).series.chapters.at(-1).id;
  renameSync(join(fx.libraries, 'Scans/Gamma Tomes/Tome 02/Chapitre 012.cbz'), join(fx.libraries, 'Scans/Gamma Tomes/Tome 02/Chapitre 013.cbz'));
  await assert.rejects(libs.getBook(bid), NotFound);
  assert.equal((await libs.getSeries(sid)).series.chapters.at(-1).name, 'Chapitre 013');
  rmSync(join(fx.libraries, 'Scans/Gamma Tomes/Tome 02/Chapitre 013.cbz'));
  assert.equal((await libs.getSeries(sid)).series.chapters.length, before);
  const betaId = await idOf(libs, 'Beta');
  renameSync(join(fx.libraries, 'Scans/Beta Folders'), join(fx.libraries, 'Scans/Beta Renamed'));
  await assert.rejects(libs.getSeries(betaId), NotFound); // renommer crée une nouvelle série
  assert.ok((await titles(libs, lib(libs, 'Scans'))).includes('Beta Renamed'));
  assert.ok(!(await titles(libs, lib(libs, 'Scans'))).includes('Beta Folders'));
});
test('a chapter or series that disappears while others remain gives NotFound, not Unavailable', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const sid = await idOf(libs, 'Beta');
  const bid = (await libs.getSeries(sid)).series.chapters[0].id;
  rmSync(join(fx.libraries, 'Scans/Beta Folders/Chapitre 1'), { recursive: true });
  await assert.rejects(libs.getBook(bid), NotFound);
  rmSync(join(fx.libraries, 'Scans/Beta Folders'), { recursive: true });
  await assert.rejects(libs.getSeries(sid), NotFound);
});
test('next and previous follow the reading order', async () => {
  const libs = await open(fixture());
  const { series } = await libs.getSeries(await idOf(libs, 'Alpha'));
  const ids = series.chapters.map((c) => c.id);
  const mid = await libs.getBook(ids[1]);
  assert.equal(mid.index, 1);
  assert.equal(series.chapters[mid.index + 1].id, ids[2]);
});

test('unmounted library (root gone): list, series and books give Unavailable, never NotFound', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const sid = await idOf(libs, 'Omega');
  const bid = (await libs.getSeries(sid)).series.chapters[0].id;
  renameSync(join(fx.libraries, 'Autre'), join(fx.root, 'Autre-demonte'));
  await assert.rejects(libs.listSeries({ library: lib(libs, 'Autre') }), Unavailable);
  await assert.rejects(libs.listSeries({}), Unavailable); // une liste partielle passerait pour complète
  await assert.rejects(libs.getSeries(sid), Unavailable);
  await assert.rejects(libs.getBook(bid), Unavailable);
  assert.deepEqual(libs.health().map((l) => l.state), ['unavailable', 'ok']);
  assert.deepEqual((await libs.listSeries({ library: lib(libs, 'Scans') })).content.length, 6); // les autres restent lisibles
  renameSync(join(fx.root, 'Autre-demonte'), join(fx.libraries, 'Autre'));
  assert.equal((await libs.getSeries(sid)).series.title, 'Omega');
  assert.equal(libs.health()[0].state, 'ok');
});
test('library emptied after having held series (locked or unmounted share): Unavailable until a manual scan confirms', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const sid = await idOf(libs, 'Omega');
  const kept = join(fx.root, 'garde');
  mkdirSync(kept);
  renameSync(join(fx.libraries, 'Autre/Omega'), join(kept, 'Omega'));
  await assert.rejects(libs.getSeries(sid), Unavailable); // série disparue dans une bibliothèque devenue vide
  await assert.rejects(libs.listSeries({ library: lib(libs, 'Autre') }), Unavailable);
  await libs.scanAll(false);
  await assert.rejects(libs.listSeries({ library: lib(libs, 'Autre') }), Unavailable); // un parcours automatique ne tranche pas
  await libs.scanAll(true); // confirmation explicite : la bibliothèque est vraiment vide
  assert.deepEqual((await libs.listSeries({ library: lib(libs, 'Autre') })).content, []);
  await assert.rejects(libs.getSeries(sid), NotFound);
});
test('a restart on a locked share stays Unavailable for identifiers it has never seen (flag persisted in the data directory)', async () => {
  const fx = fixture();
  const first = await open(fx);
  const sid = await idOf(first, 'Omega');
  assert.equal(JSON.parse(readFileSync(join(fx.data, 'libraries.json'), 'utf8')).Autre, true);
  rmSync(join(fx.libraries, 'Autre/Omega'), { recursive: true });
  const second = await open(fx); // nouveau processus : index vide, drapeau relu
  assert.equal(second.health().find((l) => l.name === 'Autre').state, 'unavailable');
  await assert.rejects(second.getSeries(sid), Unavailable);
  await assert.rejects(second.getBook(`${sid}.0123456789abcdef`), Unavailable);
  await assert.rejects(second.getSeries('0123456789abcdef'), Unavailable);
});
test('an empty library that never held series is simply empty, not unavailable', async () => {
  const fx = fixture();
  mkdirSync(join(fx.libraries, 'Neuve'));
  const libs = await open(fx);
  assert.equal(libs.health().find((l) => l.name === 'Neuve').state, 'ok');
  assert.deepEqual((await libs.listSeries({ library: lib(libs, 'Neuve') })).content, []);
  await assert.rejects(libs.getSeries('0123456789abcdef'), NotFound);
});
test('the first full scan does not empty the index when a library becomes unavailable', async () => {
  const fx = fixture();
  const libs = await open(fx);
  const sid = await idOf(libs, 'Omega');
  renameSync(join(fx.libraries, 'Autre'), join(fx.root, 'Autre-demonte'));
  await libs.scanAll(false);
  await assert.rejects(libs.getSeries(sid), Unavailable); // l'ancien identifiant est encore reconnu
});

test('search and sort: title ascending/descending, by date, pages', async () => {
  const libs = await open(fixture());
  const scans = lib(libs, 'Scans');
  assert.deepEqual((await libs.listSeries({ library: scans, search: 'ALPHA' })).content.map(({ s }) => s.title), ['Alpha Quest']);
  const desc = await libs.listSeries({ library: scans, sort: 'metadata.titleSort,desc' });
  assert.equal(desc.content[0].s.title, 'Solo Story');
  const p0 = await libs.listSeries({ library: scans, page: 0, size: 4 });
  const p1 = await libs.listSeries({ library: scans, page: 1, size: 4 });
  assert.deepEqual([p0.content.length, p0.last, p1.content.length, p1.last, p0.total], [4, false, 2, true, 6]);
  const byDate = await libs.listSeries({ library: scans, sort: 'lastModified,desc' });
  for (let i = 1; i < byDate.content.length; i++) assert.ok(byDate.content[i - 1].s.lastModified >= byDate.content[i].s.lastModified);
});

test('the code that touches libraries never writes (static check)', () => {
  const WRITES = /\b(writeFile|appendFile|createWriteStream|unlink|rmdir|rmSync|rm|mkdir|rename|copyFile|truncate|chmod|chown|symlink|link|utimes|open)\s*\(/;
  const code = (file) => readFileSync(new URL(`../folders/${file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const file of ['scan.js', 'library.js', 'ids.js', 'routes.js', 'naming.js', 'archive.js', 'reading.js', 'sniff.js', 'http.js']) {
    assert.ok(!WRITES.test(code(file)), `${file} contient un appel d'écriture`);
  }
  // Seul point d'ouverture de fichier de lecture : en lecture seule, sans suivre de lien (le motif ci-dessus ne voit pas l'alias).
  const opens = readdirSync(new URL('../folders/', import.meta.url)).filter((f) => f.endsWith('.js')).flatMap((f) => (code(f).match(/\b(?:fsOpen|openFile)\s*\(/g) || []).map(() => f));
  assert.deepEqual(opens, ['archive.js']);
  assert.match(code('archive.js'), /openFile\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/);
  assert.ok(!/\b(?:writeFile|createWriteStream|mkdtemp|tmpdir)\b/.test(code('archive.js') + code('reading.js'))); // aucun fichier temporaire
  assert.ok(readdirSync(new URL('../folders/', import.meta.url)).includes('store.js')); // seul store.js écrit, dans /data
});

run();
