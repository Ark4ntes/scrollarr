// Tests unitaires de folders/naming.js. Lancer avec : node tests/unit_folders_naming.mjs
import assert from 'node:assert/strict';
import { suite } from './_folders.mjs';
import {
  isIgnoredName, isImageName, isArchiveName, isCoverName, displayName, stripExtension, stripLabels,
  compareNames, compareSegments, detectNumber, numberSorts, searchKey,
} from '../folders/naming.js';

const { test, run } = suite('folders naming');
const sorted = (names) => [...names].sort(compareNames);

test('ignored names: hidden files and NAS system folders, case-insensitive', () => {
  for (const n of ['@eaDir', '#recycle', '.hidden', '.DS_Store', 'Thumbs.db', 'thumbs.DB', '__MACOSX']) assert.ok(isIgnoredName(n), n);
  for (const n of ['Chapitre 1', 'cover.jpg', 'a.cbz']) assert.ok(!isIgnoredName(n), n);
});
test('file types by extension, case-insensitive', () => {
  for (const n of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.gif', 'a.avif']) assert.ok(isImageName(n), n);
  for (const n of ['a.svg', 'a.tiff', 'a.pdf', 'a.txt']) assert.ok(!isImageName(n), n);
  assert.ok(isArchiveName('x.CBZ') && isArchiveName('x.zip') && !isArchiveName('x.cbr') && !isArchiveName('x.rar') && !isArchiveName('x.7z'));
  assert.ok(isCoverName('cover.JPG') && isCoverName('cover.webp') && !isCoverName('cover.gif') && !isCoverName('mycover.jpg'));
});
test('display name: NFC and trimmed; archive extension removed', () => {
  assert.equal(displayName('  Café  '), 'Café');
  assert.equal(stripExtension('Chapitre 1.cbz'), 'Chapitre 1');
  assert.equal(stripExtension('Chapitre 1.5.ZIP'), 'Chapitre 1.5');
});

test('natural sort: numbers compare as numbers, case-insensitive', () => {
  assert.deepEqual(sorted(['ch10', 'ch2', 'Ch1.5', 'ch1']), ['ch1', 'Ch1.5', 'ch2', 'ch10']);
  assert.deepEqual(sorted(['Chapitre 100', 'chapitre 20', 'Chapitre 3']), ['Chapitre 3', 'chapitre 20', 'Chapitre 100']);
  assert.deepEqual(sorted(['b', 'A', 'a', 'B']).map((s) => s.toLowerCase()), ['a', 'a', 'b', 'b']);
});
test('natural sort is stable and total on names equal up to case', () => {
  assert.deepEqual(sorted(['a', 'A']), sorted(['A', 'a']));
  assert.equal(compareNames('x', 'x'), 0);
});
test('bracket labels at the start are ignored for ordering', () => {
  assert.equal(stripLabels('[Team B] 001'), '001');
  assert.equal(stripLabels('[A][B] Chap 2'), 'Chap 2');
  assert.equal(stripLabels('[seul]'), '[seul]');
  assert.deepEqual(sorted(['[A] 002', '[B] 001']), ['[B] 001', '[A] 002']);
});
test('paths compare segment by segment', () => {
  assert.ok(compareSegments(['Tome 2', 'Chapitre 1'], ['Tome 10', 'Chapitre 1']) < 0);
  assert.ok(compareSegments(['Tome 1'], ['Tome 1', 'x']) < 0);
  assert.ok(compareSegments(['Tome 1', 'Chapitre 5'], ['Tome 2', 'Chapitre 1']) < 0);
});

// Corpus de noms (à compléter avec la bibliothèque réelle, question Q5 de l'étude).
const CORPUS = [
  ['Chapitre 012', '', 12], ['Chapitre 012 - Titre', '', 12], ['Ch.5', '', 5], ['chap_7', '', 7], ['Chapter 10.5', '', 10.5],
  ['Chapitre 5,5', '', 5.5], ['Ep 03', '', 3], ['#12', '', 12], ['c045', '', 45],
  ['Tome 2 Chapitre 10', '', 10], ['Scene 3 ch 4', '', 4],
  ['One Piece 1045', 'One Piece', 1045], ['Dr. Stone 2 - 015', 'Dr. Stone 2', 15],
  ['Vol 03 (2019)', '', 3], ['[Team] 004', '', 4], ['001 [Team] (HD)', '', 1],
  ['Check 7', '', 7], ['Magic 10', '', 10], ['abc2def', '', 2],
  ['Prologue', '', null], ['Extra', '', null], ['', '', null],
];
test('chapter number detection over the name corpus', () => {
  for (const [name, title, expected] of CORPUS) assert.equal(detectNumber(name, title), expected, `${name} (${title})`);
});
test('numberSort: detected numbers if all present and strictly increasing, else rank', () => {
  assert.deepEqual(numberSorts([1, 2, 2.5, 10]), [1, 2, 2.5, 10]);
  assert.deepEqual(numberSorts([1, null, 3]), [1, 2, 3]);
  assert.deepEqual(numberSorts([1, 1, 2]), [1, 2, 3]);
  assert.deepEqual(numberSorts([3, 2, 1]), [1, 2, 3]);
  assert.deepEqual(numberSorts([]), []);
});
test('search key ignores case and accents', () => {
  assert.equal(searchKey('Éléphant'), 'elephant');
  assert.ok(searchKey('L’Été Indien').includes(searchKey('ete')));
});

run();
