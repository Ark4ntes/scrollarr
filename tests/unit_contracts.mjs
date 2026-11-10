// Unit tests for the connector contracts. Run with: node tests/unit_contracts.mjs
import assert from 'node:assert/strict';
import { CAP } from '../app/js/connectors/contract.js';
import { validateReader } from '../app/js/connectors/reader-contract.js';
import { validateCollector } from '../app/js/connectors/collector-contract.js';

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
test('a reader missing a method is refused', () => assert.throws(() => validateReader(reader({ bookPages: undefined })), /bookPages/));
test('a reader declaring progress.write must provide the methods', () =>
  assert.throws(() => validateReader(reader({ capabilities: [CAP.PROGRESS_WRITE] })), /saveProgress/));
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

console.log(failed ? `\n${failed} test(s) failed` : '\nAll contract unit tests passed');
process.exit(failed ? 1 : 0);
