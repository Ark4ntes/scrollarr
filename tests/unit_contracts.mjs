// Unit tests for the connector contracts. Run with: node tests/unit_contracts.mjs
import assert from 'node:assert/strict';
import { CAP } from '../app/js/connectors/contract.js';
import { validateReader } from '../app/js/connectors/reader-contract.js';
import { validateCollector, normalizeSource, normalizeResult, normalizeSearch, normalizeAdded } from '../app/js/connectors/collector-contract.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const fn = () => {};
const reader = (extra = {}) => ({
  id: 'demo', code: 'd', label: 'Demo', userLabel: 'User', capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ],
  ...Object.fromEntries(['session', 'login', 'logout', 'libraries', 'genres', 'seriesList', 'seriesNew', 'seriesUpdated', 'series',
    'seriesBooks', 'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead', 'book', 'bookPages', 'nextBook',
    'previousBook', 'seriesThumb', 'bookThumb'].map((m) => [m, fn])),
  ...extra,
});
const collector = (extra = {}) => ({ id: 'demo', label: 'Demo', capabilities: [CAP.COLLECT_CHAPTERS], serves: ['demo'], session: 'demo', collectChapters: fn, ...extra });

test('a complete reader is accepted', () => assert.ok(validateReader(reader())));
test('a reader without progress.write is supported (reading only, no progress methods required)', () =>
  assert.ok(validateReader(reader({ capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ] }))));
test('a reader missing a method is refused', () => assert.throws(() => validateReader(reader({ bookPages: undefined })), /bookPages/));
test('a reader declaring progress.write must provide the methods', () =>
  assert.throws(() => validateReader(reader({ capabilities: [CAP.PROGRESS_WRITE] })), /saveProgress/));
const progress = ['saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread'];
const full = [CAP.SERIES_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_READ, CAP.PROGRESS_WRITE, CAP.PROGRESS_PROFILES];
const withProgress = Object.fromEntries(progress.map((m) => [m, fn]));
test('chapter.progress.profiles needs setProfile() and forgetProfile()', () => {
  assert.throws(() => validateReader(reader({ capabilities: full, ...withProgress })), /setProfile/);
  assert.throws(() => validateReader(reader({ capabilities: full, ...withProgress, setProfile: fn })), /forgetProfile/);
  assert.ok(validateReader(reader({ capabilities: full, ...withProgress, setProfile: fn, forgetProfile: fn })));
});
test('chapter.progress.profiles needs progress.read and progress.write', () => {
  const both = { ...withProgress, setProfile: fn, forgetProfile: fn };
  assert.throws(() => validateReader(reader({ capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_PROFILES], ...both })), /chapter\.progress\.read/);
  assert.throws(() => validateReader(reader({ capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_READ, CAP.PROGRESS_PROFILES], ...both })), /chapter\.progress\.write/);
});
test('a collector cannot declare chapter.progress.profiles', () =>
  assert.throws(() => validateCollector(collector({ capabilities: [CAP.PROGRESS_PROFILES] }), ['demo']), /chapter\.progress\.profiles/));
test('a reader cannot declare a collector capability', () =>
  assert.throws(() => validateReader(reader({ capabilities: [CAP.COLLECT_CHAPTERS] })), /collect\.chapters/));
test('a reader needs a one-letter code', () => assert.throws(() => validateReader(reader({ code: 'xx' })), /code/));

test('a collector needs none of the reading methods', () => assert.ok(validateCollector(collector(), ['demo'])));
test('a collector declaring collect.chapters must provide collectChapters', () =>
  assert.throws(() => validateCollector(collector({ collectChapters: undefined }), ['demo']), /collectChapters/));
test('a collector cannot declare a reader capability', () =>
  assert.throws(() => validateCollector(collector({ capabilities: [CAP.SERIES_LIST] }), ['demo']), /series\.list/));
test('a collector must serve readers that exist', () => assert.throws(() => validateCollector(collector(), ['other']), /inconnu/));
test('collect.chapters needs at least one reader to serve', () =>
  assert.throws(() => validateCollector(collector({ serves: [] }), ['demo']), /serves/));
test('a collector with its own server must handle its own session', () => {
  assert.throws(() => validateCollector(collector({ session: undefined }), ['demo']), /session/);
  assert.throws(() => validateCollector(collector({ session: fn }), ['demo']), /login/);
  assert.ok(validateCollector(collector({ session: fn, login: fn, logout: fn }), ['demo']));
});

test('collect.tasks needs tasks() and resolveTasks(); collect.cancel needs cancelTask() and collect.tasks', () => {
  const caps = [CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS];
  assert.throws(() => validateCollector(collector({ capabilities: caps, tasks: fn }), ['demo']), /resolveTasks/);
  assert.ok(validateCollector(collector({ capabilities: caps, tasks: fn, resolveTasks: fn }), ['demo']));
  assert.throws(() => validateCollector(collector({ capabilities: [...caps, CAP.COLLECT_CANCEL], tasks: fn, resolveTasks: fn }), ['demo']), /cancelTask/);
  assert.throws(() => validateCollector(collector({ capabilities: [CAP.COLLECT_CHAPTERS, CAP.COLLECT_CANCEL], cancelTask: fn }), ['demo']), /collect\.tasks/);
  assert.throws(() => validateCollector(collector({ capabilities: [...caps, CAP.COLLECT_RETRY], tasks: fn, resolveTasks: fn }), ['demo']), /retryTask/);
  assert.throws(() => validateCollector(collector({ capabilities: [CAP.COLLECT_CHAPTERS, CAP.COLLECT_RETRY], retryTask: fn }), ['demo']), /collect\.tasks/);
});

// ── Recherche par titre (COL-001) ──
const searching = [CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH, CAP.COLLECT_ADD];
const searcher = (extra = {}) => collector({ capabilities: searching, sources: fn, search: fn, add: fn, ...extra });
test('a collector can search and add without collect.chapters, and without any reader id', () => {
  assert.ok(validateCollector(searcher({ capabilities: searching, serves: [], session: fn, login: fn, logout: fn }), ['demo']));
});
test('collect.sources, collect.search and collect.add each need their method', () => {
  assert.throws(() => validateCollector(searcher({ sources: undefined }), ['demo']), /sources/);
  assert.throws(() => validateCollector(searcher({ search: undefined }), ['demo']), /search/);
  assert.throws(() => validateCollector(searcher({ add: undefined }), ['demo']), /add/);
});
test('collect.search needs collect.sources, collect.add needs collect.search', () => {
  assert.throws(() => validateCollector(searcher({ capabilities: [CAP.COLLECT_SEARCH] }), ['demo']), /collect\.sources/);
  assert.throws(() => validateCollector(searcher({ capabilities: [CAP.COLLECT_SOURCES, CAP.COLLECT_ADD] }), ['demo']), /collect\.search/);
  assert.ok(validateCollector(searcher({ capabilities: [CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH] }), ['demo']));
});
test('a reader cannot declare the search capabilities', () => {
  for (const cap of searching) assert.throws(() => validateReader(reader({ capabilities: [cap] })), /inconnue/);
});

const source = (extra = {}) => ({ id: '7', label: 'Source', language: 'fr', nsfw: false, icon: '/demo/icon/7', ...extra });
const result = (extra = {}) => ({
  id: '42', title: 'Titre', cover: '/demo/api/v1/manga/42/thumbnail', sourceId: '7', sourceLabel: 'Source', language: 'fr',
  inLibrary: false, reader: null, seriesId: null, ...extra,
});
const k = { id: 'demo', serves: ['demo'] };
const kAlone = { id: 'alone', serves: [] }; // collecteur sans identifiants communs avec un lecteur (Tranga, Mangarr)
test('a source needs a text id and label, a boolean nsfw and a same-origin icon', () => {
  assert.deepEqual(normalizeSource(k, source()), source());
  assert.deepEqual(normalizeSource(k, { id: '7', label: 'S', nsfw: true }), { id: '7', label: 'S', language: null, nsfw: true, icon: null }, 'optional fields become null');
  assert.throws(() => normalizeSource(k, source({ id: 7 })), /id/);
  assert.throws(() => normalizeSource(k, source({ id: '' })), /id/);
  assert.throws(() => normalizeSource(k, source({ label: '' })), /label/);
  assert.throws(() => normalizeSource(k, source({ nsfw: undefined })), /nsfw/);
  assert.throws(() => normalizeSource(k, source({ language: 3 })), /language/);
  assert.throws(() => normalizeSource(k, source({ icon: 'https://cdn.example/icon.png' })), /icon/);
  assert.throws(() => normalizeSource(k, source({ icon: '//cdn.example/icon.png' })), /icon/);
});
test('a result outside the library carries no reader series', () => {
  assert.deepEqual(normalizeResult(k, result()), result());
  assert.equal(normalizeResult(k, result({ cover: undefined })).cover, null);
  assert.throws(() => normalizeResult(k, result({ title: '' })), /title/);
  assert.throws(() => normalizeResult(k, result({ inLibrary: 'yes' })), /inLibrary/);
  assert.throws(() => normalizeResult(k, result({ cover: 'http://elsewhere/c.png' })), /cover/);
  assert.throws(() => normalizeResult(k, result({ sourceId: undefined })), /sourceId/);
});
test('a result in the library names the reader and its series, together', () => {
  assert.equal(normalizeResult(k, result({ inLibrary: true, reader: 'demo', seriesId: '42' })).seriesId, '42');
  assert.throws(() => normalizeResult(k, result({ inLibrary: true, reader: 'demo' })), /vont ensemble/);
  assert.throws(() => normalizeResult(k, result({ inLibrary: true, seriesId: '42' })), /vont ensemble/);
  assert.throws(() => normalizeResult(k, result({ inLibrary: true, reader: 'other', seriesId: '42' })), /serves/);
  assert.throws(() => normalizeResult(k, result({ inLibrary: false, reader: 'demo', seriesId: '42' })), /inLibrary/);
});
test('a collector that shares no ids says "followed" without any reader series', () => {
  assert.equal(normalizeResult(kAlone, result({ inLibrary: true })).seriesId, null);
  assert.throws(() => normalizeResult(kAlone, result({ inLibrary: true, reader: 'demo', seriesId: '42' })), /serves/);
});
test('a search response is a list of results and a "more" flag', () => {
  assert.deepEqual(normalizeSearch(k, { results: [result()], more: true }), { results: [result()], more: true });
  assert.equal(normalizeSearch(k, { results: [] }).more, false);
  assert.throws(() => normalizeSearch(k, {}), /results/);
  assert.throws(() => normalizeSearch(k, { results: [{}] }), /id/);
});
test('an add response gives the reader series, or nothing for a collector without common ids', () => {
  assert.deepEqual(normalizeAdded(k, { reader: 'demo', seriesId: '42', complete: true }), { reader: 'demo', seriesId: '42', complete: true });
  assert.deepEqual(normalizeAdded(kAlone, { complete: true }), { reader: null, seriesId: null, complete: true });
  assert.throws(() => normalizeAdded(k, { reader: 'demo', complete: true }), /vont ensemble/);
  assert.throws(() => normalizeAdded(k, { reader: null, seriesId: null }), /complete/);
  assert.throws(() => normalizeAdded(kAlone, { reader: 'demo', seriesId: '42', complete: true }), /serves/);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll contract unit tests passed');
process.exit(failed ? 1 : 0);
