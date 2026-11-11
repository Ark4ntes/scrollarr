// Stockage de la progression du service folders (READ-002 §4.6) : mémoire et fichiers, sans HTTP.
// Écriture atomique, redémarrage, fichier corrompu, regroupement des écritures, profils.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createFileProgress, createMemoryProgress, isProfileId, MAX_PROFILES, ProfileLimit, ProgressUnavailable } from '../folders/progress.js';
import { seriesId, bookId } from '../folders/ids.js';
import { suite, tmp, quiet, sleep } from './_folders.mjs';

const { test, run } = suite('folders progress');
const SID = seriesId('Scans', 'Alpha');
const B1 = bookId('Scans', 'Alpha', 'Alpha/ch1.cbz');
const B2 = bookId('Scans', 'Alpha', 'Alpha/ch2.cbz');
const rec = (page, completed = false, date = 1000, pages = 10) => ({ page, completed, date, pages });
const warnings = () => { const w = []; return { log: { log() {}, warn: (m) => w.push(m), error() {} }, w }; };
const fileStore = (dir, opts = {}) => createFileProgress({ dataDir: dir, flushMs: 0, log: quiet, ...opts });
const fileOf = (dir, profile = 'main', sid = SID) => join(dir, 'progress', profile, `${sid}.json`);

for (const [name, make] of [['memory', () => createMemoryProgress()], ['files', () => fileStore(tmp())]]) {
  test(`${name}: set, read back, replace, clear`, async () => {
    const s = make();
    assert.equal((await s.snapshot('main')).size, 0);
    await s.setMany('main', SID, [[B1, rec(3)], [B2, rec(10, true, 2000)]]);
    const snap = await s.snapshot('main');
    assert.deepEqual(snap.get(SID).get(B1), rec(3));
    assert.equal(snap.get(SID).get(B2).completed, true);
    await s.setMany('main', SID, [[B1, rec(4, false, 3000, null)]]);
    assert.deepEqual((await s.snapshot('main')).get(SID).get(B1), rec(4, false, 3000, null));
    await s.clear('main', SID, [B1, 'inconnu']);
    assert.equal((await s.snapshot('main')).get(SID).has(B1), false);
    assert.equal((await s.snapshot('main')).get(SID).has(B2), true);
    await s.close();
  });

  test(`${name}: recent lists the newest first, optionally only the chapters not finished`, async () => {
    const s = make();
    const other = seriesId('Scans', 'Beta');
    const C1 = bookId('Scans', 'Beta', 'Beta/c1');
    await s.setMany('main', SID, [[B1, rec(2, false, 100)], [B2, rec(10, true, 300)]]);
    await s.setMany('main', other, [[C1, rec(1, false, 200)]]);
    assert.deepEqual((await s.recent('main')).map((e) => e.bid), [B2, C1, B1]);
    assert.deepEqual((await s.recent('main', { completed: false })).map((e) => e.bid), [C1, B1]);
    assert.deepEqual((await s.recent('main', { completed: true })).map((e) => e.bid), [B2]);
    assert.deepEqual(await s.recent('p1'), []);
    await s.close();
  });

  test(`${name}: profiles are independent, and a profile can be forgotten`, async () => {
    const s = make();
    await s.setMany('main', SID, [[B1, rec(2)]]);
    await s.setMany('p1', SID, [[B1, rec(7, true)]]);
    assert.equal((await s.snapshot('main')).get(SID).get(B1).page, 2);
    assert.equal((await s.snapshot('p1')).get(SID).get(B1).completed, true);
    await s.forgetProfile('p1');
    assert.equal((await s.snapshot('p1')).size, 0);
    assert.equal((await s.snapshot('main')).get(SID).get(B1).page, 2);
    await s.close();
  });

  test(`${name}: at most ${MAX_PROFILES} profiles; existing ones keep working`, async () => {
    const s = make();
    for (let i = 0; i < MAX_PROFILES; i++) await s.setMany(`p${i}`, SID, [[B1, rec(1)]]);
    await assert.rejects(() => s.setMany('autre', SID, [[B1, rec(1)]]), ProfileLimit);
    await s.setMany('p3', SID, [[B1, rec(5)]]);
    await s.forgetProfile('p4'); // libère une place
    await s.setMany('autre', SID, [[B1, rec(1)]]);
    assert.equal((await s.snapshot('p3')).get(SID).get(B1).page, 5);
    await s.close();
  });

  test(`${name}: identifiers that are not what they claim are refused`, async () => {
    const s = make();
    await assert.rejects(() => s.snapshot('../x'));
    await assert.rejects(() => s.setMany('main', '../x', [[B1, rec(1)]]));
    await assert.rejects(() => s.setMany('main', SID, [[`${seriesId('Scans', 'Autre')}.${'0'.repeat(16)}`, rec(1)]])); // chapitre d'une autre série
    assert.ok(isProfileId('main') && isProfileId('p9x') && !isProfileId('') && !isProfileId('a/b') && !isProfileId('x'.repeat(33)));
    await s.close();
  });
}

test('files: a restart finds everything (a new store on the same folder)', async () => {
  const dir = tmp();
  const a = fileStore(dir);
  await a.setMany('main', SID, [[B1, rec(3, false, 1700000000000, 12)], [B2, rec(10, true, 1700000001000, 10)]]);
  await a.setMany('p2', SID, [[B1, rec(9)]]);
  await a.close();
  const b = fileStore(dir);
  const snap = await b.snapshot('main');
  assert.deepEqual([...snap.get(SID)], [[B1, rec(3, false, 1700000000000, 12)], [B2, rec(10, true, 1700000001000, 10)]]);
  assert.equal((await b.snapshot('p2')).get(SID).get(B1).page, 9);
  await b.close();
});

test('files: on-disk format is { chapter: [page, finished, date, pages] } in progress/<profile>/<series>.json', async () => {
  const dir = tmp();
  const s = fileStore(dir);
  await s.setMany('main', SID, [[B1, rec(3, false, 1700000000000, null)], [B2, rec(10, true, 1700000001000, 10)]]);
  await s.close();
  assert.deepEqual(JSON.parse(await fs.readFile(fileOf(dir), 'utf8')), { [B1]: [3, 0, 1700000000000, null], [B2]: [10, 1, 1700000001000, 10] });
  assert.deepEqual((await fs.readdir(join(dir, 'progress', 'main'))).filter((n) => n.endsWith('.tmp')), []);
});

test('files: writes are grouped: nothing on disk before the delay, one file after, and close() flushes at once', async () => {
  const dir = tmp();
  const s = fileStore(dir, { flushMs: 300 });
  await s.setMany('main', SID, [[B1, rec(1)]]);
  await s.setMany('main', SID, [[B1, rec(2)]]);
  await s.setMany('main', SID, [[B1, rec(3)]]);
  await assert.rejects(() => fs.stat(fileOf(dir)), { code: 'ENOENT' });
  await sleep(500);
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 3);
  await s.setMany('main', SID, [[B1, rec(4)]]);
  await s.close(); // sans attendre le délai (SIGTERM)
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 4);
  await s.setMany('main', SID, [[B1, rec(5)]]); // après close : plus rien n'est écrit
  await sleep(400);
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 4);
});

test('files: an interrupted write leaves the previous file intact (the rename is the only step that replaces it)', async () => {
  const dir = tmp();
  const a = fileStore(dir);
  await a.setMany('main', SID, [[B1, rec(5, false, 1700000000000, 8)]]);
  await a.close();
  // Une écriture coupée net : un .tmp tronqué à côté du bon fichier.
  await fs.writeFile(`${fileOf(dir)}.tmp`, '{"tronqu');
  const b = fileStore(dir);
  assert.equal((await b.snapshot('main')).get(SID).get(B1).page, 5);
  await b.setMany('main', SID, [[B1, rec(6, false, 1700000002000, 8)]]); // le .tmp est simplement réécrit
  await b.close();
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 6);
  assert.deepEqual((await fs.readdir(join(dir, 'progress', 'main'))).filter((n) => n.endsWith('.tmp')), []);
});

test('files: a corrupted file is set aside as .corrupt, warned about, never overwritten; the other series are unaffected', async () => {
  const dir = tmp();
  const other = seriesId('Scans', 'Beta');
  const C1 = bookId('Scans', 'Beta', 'Beta/c1');
  const a = fileStore(dir);
  await a.setMany('main', other, [[C1, rec(2)]]);
  await a.close();
  await fs.writeFile(fileOf(dir), '{ pas du json');
  const { log, w } = warnings();
  const b = fileStore(dir, { log });
  const snap = await b.snapshot('main');
  assert.equal(snap.has(SID), false);
  assert.equal(snap.get(other).get(C1).page, 2);
  assert.equal(w.length, 1);
  assert.match(w[0], /mise de côté/);
  assert.ok(!w[0].includes(dir), 'le message ne contient aucun chemin du disque');
  assert.equal(await fs.readFile(`${fileOf(dir)}.corrupt`, 'utf8'), '{ pas du json'); // gardé pour une réparation à la main
  await assert.rejects(() => fs.stat(fileOf(dir)), { code: 'ENOENT' });
  await b.setMany('main', SID, [[B1, rec(1)]]); // la série repart à zéro
  await b.close();
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 1);
  assert.equal(await fs.readFile(`${fileOf(dir)}.corrupt`, 'utf8'), '{ pas du json');
});

test('files: a file of the wrong shape (array, wrong series, bad values) is dropped entry by entry or as a whole', async () => {
  const dir = tmp();
  const foreign = bookId('Scans', 'Autre', 'Autre/c1');
  await fs.mkdir(join(dir, 'progress', 'main'), { recursive: true });
  await fs.writeFile(fileOf(dir), JSON.stringify({
    [B1]: [3, 0, 1700000000000, 10], [B2]: [-1, 0, 1700000000000, 10], [foreign]: [1, 0, 1700000000000, 1], 'pas-un-id': [1, 0, 1700000000000, 1],
    [bookId('Scans', 'Alpha', 'Alpha/ch3')]: [1, 2, 1700000000000, 1], [bookId('Scans', 'Alpha', 'Alpha/ch4')]: 'x',
  }));
  const other = seriesId('Scans', 'Beta');
  await fs.writeFile(fileOf(dir, 'main', other), '[1,2,3]');
  const { log, w } = warnings();
  const s = fileStore(dir, { log });
  const snap = await s.snapshot('main');
  assert.deepEqual([...snap.get(SID).keys()], [B1]);
  assert.equal(snap.has(other), false);
  assert.equal(w.length, 2);
  await fs.stat(`${fileOf(dir, 'main', other)}.corrupt`);
  await s.close();
});

test('files: a write that fails keeps the entry and is retried; nothing is lost', async () => {
  const dir = tmp();
  const { log, w } = warnings();
  const s = fileStore(dir, { log, flushMs: 0 });
  await s.snapshot('main');
  await fs.writeFile(join(dir, 'progress'), 'je suis un fichier, pas un dossier'); // mkdir impossible
  await s.setMany('main', SID, [[B1, rec(4)]]);
  await s.flush();
  assert.ok(w.some((m) => /non écrite/.test(m)), w);
  await fs.rm(join(dir, 'progress'));
  await s.flush(); // le disque est de nouveau utilisable
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 4);
  await s.close();
});

test('files: a progress folder that cannot be read is an error, never an empty table that a later write would overwrite', async () => {
  const dir = tmp();
  await fs.writeFile(join(dir, 'progress'), 'je suis un fichier, pas un dossier');
  const s = fileStore(dir);
  await assert.rejects(() => s.snapshot('main'), ProgressUnavailable);
  await assert.rejects(() => s.setMany('main', SID, [[B1, rec(1)]]), ProgressUnavailable);
  await fs.rm(join(dir, 'progress'));
  assert.equal((await s.snapshot('main')).size, 0); // la lecture est retentée
  await s.close();
});

test('files: forgetting a profile removes its folder and cancels pending writes', async () => {
  const dir = tmp();
  const s = fileStore(dir, { flushMs: 10000 });
  await s.setMany('p1', SID, [[B1, rec(2)]]);
  await s.flush();
  await s.setMany('p1', SID, [[B1, rec(3)]]); // en attente
  await s.setMany('main', SID, [[B1, rec(1)]]);
  await s.forgetProfile('p1');
  await s.close();
  await assert.rejects(() => fs.stat(join(dir, 'progress', 'p1')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))[B1][0], 1);
});

test('files: progress of a chapter that disappeared is kept (no automatic purge)', async () => {
  const dir = tmp();
  const a = fileStore(dir);
  await a.setMany('main', SID, [[B1, rec(5)]]);
  await a.close();
  // Le service ne connaît pas la bibliothèque ici : il ne peut donc rien purger, et ne le tente pas.
  const b = fileStore(dir);
  await b.setMany('main', SID, [[B2, rec(1)]]);
  await b.close();
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))).sort(), [B1, B2].sort());
});

run();
