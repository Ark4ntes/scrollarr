// Identifiants, résolution et confinement des chemins (folders/ids.js).
// Lancer avec : node tests/unit_folders_ids.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { suite, tmp } from './_folders.mjs';
import {
  libraryId, seriesId, bookId, isSeriesId, isBookId, seriesOfBook, createRegistry,
  confine, confineFile, resolve, ConfinementError,
} from '../folders/ids.js';

const { test, run } = suite('folders ids');
const rejects = (p, re = ConfinementError) => assert.rejects(p, re);

test('identifiers are lowercase hex, deterministic, and carry no path', () => {
  const sid = seriesId('Scans', 'Alpha Quest');
  assert.match(sid, /^[0-9a-f]{16}$/);
  assert.equal(sid, seriesId('Scans', 'Alpha Quest'));
  const bid = bookId('Scans', 'Alpha Quest', 'Alpha Quest/Chapitre 1.cbz');
  assert.match(bid, /^[0-9a-f]{16}\.[0-9a-f]{16}$/);
  assert.equal(seriesOfBook(bid), sid);
  assert.ok(!bid.includes('Alpha') && !sid.includes('Alpha'));
  assert.match(libraryId('Scans'), /^[0-9a-f]{16}$/);
});
test('identity includes the library name and the relative path', () => {
  assert.notEqual(seriesId('Scans', 'A'), seriesId('Autre', 'A'));
  assert.notEqual(seriesId('Scans', 'A'), seriesId('Scans', 'B'));
  assert.notEqual(bookId('Scans', 'A', 'A/1.cbz'), bookId('Scans', 'A', 'A/2.cbz'));
  assert.notEqual(libraryId('Scans'), seriesId('Scans', 'Scans'));
});
test('NFC and NFD spellings of a name give the same identifier', () => {
  assert.equal(seriesId('Scans', 'Café'), seriesId('Scans', 'Café'));
});
test('identifier syntax checks refuse anything else', () => {
  assert.ok(isSeriesId('0123456789abcdef') && isBookId('0123456789abcdef.0123456789abcdef'));
  for (const bad of ['', '0123456789ABCDEF', '0123456789abcde', '../etc/passwd', '..%2f..', '0123456789abcdef.', null, undefined, 12]) {
    assert.ok(!isSeriesId(bad) && !isBookId(bad), String(bad));
  }
  assert.ok(!isSeriesId('0123456789abcdef.0123456789abcdef'));
});
test('registry: one table from identifier to location', () => {
  const r = createRegistry();
  r.add('a', 'Scans', 'Serie');
  assert.deepEqual(r.locate('a'), { library: 'Scans', rel: 'Serie' });
  assert.equal(r.locate('b'), null);
  r.remove('a');
  assert.equal(r.locate('a'), null);
});

function sandbox() {
  const base = tmp();
  const root = join(base, 'lib');
  mkdirSync(join(root, 'Serie/Chapitre 1'), { recursive: true });
  writeFileSync(join(root, 'Serie/Chapitre 1/001.png'), 'x');
  writeFileSync(join(root, 'Serie/a.cbz'), 'x');
  mkdirSync(join(base, 'dehors'));
  writeFileSync(join(base, 'dehors/secret.txt'), 's');
  symlinkSync(join(base, 'dehors'), join(root, 'lien-dossier'));           // dossier hors bibliothèque
  symlinkSync(join(base, 'dehors/secret.txt'), join(root, 'Serie/lien.txt')); // fichier hors bibliothèque
  symlinkSync('../..', join(root, 'Serie/remonte'));                         // lien relatif vers le parent
  symlinkSync(join(root, 'Serie'), join(root, 'lien-interne'));              // lien vers l'intérieur : pas suivi non plus
  return { base, root };
}

test('confine accepts ordinary entries and the root itself', async () => {
  const { root } = sandbox();
  assert.ok((await confine(root, 'Serie')).endsWith('/lib/Serie'));
  assert.ok((await confine(root, 'Serie/Chapitre 1')).endsWith('Chapitre 1'));
  assert.ok((await confine(root, '')).endsWith('/lib'));
  assert.ok((await confineFile(root, 'Serie/a.cbz')).endsWith('a.cbz'));
});
test('confine refuses .., absolute paths, empty segments and NUL', async () => {
  const { root, base } = sandbox();
  for (const bad of ['..', '../dehors', 'Serie/../../dehors/secret.txt', 'Serie/..', './Serie', 'Serie//a.cbz', 'Serie/', '/etc/passwd', join(base, 'dehors/secret.txt'), 'Serie\0.cbz']) {
    await rejects(confine(root, bad));
  }
  await rejects(confine(root, 42));
  await rejects(confine(root, undefined));
});
test('encoded traversal is only an ordinary (missing) file name', async () => {
  const { root } = sandbox();
  for (const bad of ['%2e%2e/dehors/secret.txt', '..%2fdehors', 'Serie/%2e%2e']) {
    await rejects(confine(root, bad), /ENOENT/);
  }
});
test('symbolic links are never followed, whatever their target', async () => {
  const { root } = sandbox();
  await rejects(confine(root, 'lien-dossier'));
  await rejects(confine(root, 'lien-dossier/secret.txt'));
  await rejects(confine(root, 'Serie/remonte'));
  await rejects(confine(root, 'Serie/remonte/dehors'));
  await rejects(confine(root, 'lien-interne'));
  await rejects(confine(root, 'lien-interne/a.cbz'));
  await rejects(confineFile(root, 'Serie/lien.txt'));
});
test('confineFile refuses a directory', async () => {
  const { root } = sandbox();
  await rejects(confineFile(root, 'Serie/Chapitre 1'));
});
test('a library root that is itself reached through a link is resolved once, then confined', async () => {
  const { base, root } = sandbox();
  const alias = join(base, 'alias');
  symlinkSync(root, alias);
  assert.ok((await confine(alias, 'Serie')).endsWith('/lib/Serie'));
  await rejects(confine(alias, 'lien-dossier'));
});
test('resolve: identifier to confined path; unknown identifier gives null', async () => {
  const { root } = sandbox();
  const r = createRegistry();
  r.add('s1', 'Scans', 'Serie');
  r.add('s2', 'Scans', '../dehors');
  r.add('s3', 'Absente', 'Serie');
  const roots = new Map([['Scans', root]]);
  assert.ok((await resolve(r, roots, 's1')).endsWith('/lib/Serie'));
  assert.equal(await resolve(r, roots, 'inconnu'), null);
  assert.equal(await resolve(r, roots, 's3'), null);
  await rejects(resolve(r, roots, 's2'));
});

run();
