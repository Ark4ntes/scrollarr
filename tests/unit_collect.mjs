// Unit tests for searching by title and adding a series (COL-001, COL-002), without a browser:
// the Suwayomi collector against a stubbed fetch (exact GraphQL operations and variables), the isolated
// requests of net.js, the source-selection helpers, and the facade with a test-only collector.
// Run with: node tests/unit_collect.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'fr-FR' }, configurable: true }); } catch { /* déjà défini */ }

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.stack.split('\n').slice(0, 3).join('\n  ')); }
}

// ───────────── Faux serveur : répond selon l'opération GraphQL, et garde ce qu'il a reçu ─────────────
const sent = [];
let handlers = {};
let mode = 'servers'; // « servers » : servers.json annonce nos lecteurs de test ; « net » : réponses brutes pour les tests de net.js
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('servers.json')) return { ok: true, status: 200, json: async () => ({ plain: true, other: true }) };
  const body = init.body ? JSON.parse(init.body) : null;
  if (!body) throw new TypeError('network');
  sent.push({ url: String(url), op: body.operationName, variables: body.variables, query: body.query, timeout: init.signal });
  const handler = handlers[body.operationName];
  if (!handler) return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Unknown operation' }] }) };
  const out = await handler(body.variables, init);
  if (out instanceof Response) return out;
  return { ok: true, status: 200, json: async () => out };
};

const { CAP } = await import('../app/js/connectors/contract.js');
const { normalizeSource, normalizeResult, normalizeSearch, normalizeAdded, validateCollector } = await import('../app/js/connectors/collector-contract.js');
const { createSuwayomiCollector, toSource, toResult } = await import('../app/js/connectors/collectors/suwayomi.js');
const { suwayomiClient } = await import('../app/js/connectors/suwayomi-client.js');
const { Q } = await import('../app/js/connectors/suwayomi-queries.js');
const net = await import('../app/js/net.js');
const ss = await import('../app/js/sourcesearch.js');

// ───────────── Collecteur Suwayomi ─────────────
const BASE = '/suwayomi';
const collector = () => createSuwayomiCollector({ base: BASE });
const node = (id, name, lang, nsfw = false) => ({ id, name, lang, iconUrl: `/api/v1/extension/icon/pkg.${id}`, isNsfw: nsfw });

await test('the Suwayomi collector honours the contract it declares', () => {
  const k = collector();
  for (const cap of [CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH, CAP.COLLECT_ADD, CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS]) assert.ok(k.capabilities.includes(cap), cap);
  assert.ok(validateCollector(k, ['suwayomi', 'komga']));
});

await test('sources(): sends the Sources query, drops the local source, sorts, maps icon, language and the NSFW flag', async () => {
  sent.length = 0;
  handlers = { Sources: () => ({ data: { sources: { nodes: [
    node('3', 'Zeta', 'en'), node('0', 'Local source', 'localsourcelang'), node('2', 'alpha', 'fr'), node('4', 'Adulte', 'fr', true), node('5', 'Alpha', 'all'),
  ] } } }) };
  const list = await collector().sources();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op, 'Sources');
  assert.equal(sent[0].query, Q.Sources);
  assert.deepEqual(list.map((s) => s.id), ['4', '5', '2', '3'], 'no local source; sorted by name ignoring case, then by language');
  assert.deepEqual(list[0], { id: '4', label: 'Adulte', language: 'fr', nsfw: true, icon: '/suwayomi/api/v1/extension/icon/pkg.4' });
  const k = collector();
  for (const s of list) assert.doesNotThrow(() => normalizeSource(k, s));
});

await test('search(): one SourceSearch mutation with a text source id, the query and page 1; results follow the contract', async () => {
  sent.length = 0;
  handlers = {
    Sources: () => ({ data: { sources: { nodes: [node('1001', 'MangaFixe', 'fr')] } } }),
    SourceSearch: () => ({ data: { fetchSourceManga: { hasNextPage: true, mangas: [
      { id: 100, title: 'Lune', thumbnailUrl: '/api/v1/manga/100/thumbnail', inLibrary: false },
      { id: 2, title: 'Café', thumbnailUrl: null, inLibrary: true },
    ] } } }),
  };
  const k = collector();
  const res = await k.search('1001', 'lune');
  assert.deepEqual(sent.map((s) => s.op), ['Sources', 'SourceSearch'], 'the source is looked up once to name its results');
  assert.deepEqual(sent[1].variables, { source: '1001', query: 'lune' });
  assert.match(Q.SourceSearch, /\$source: LongString!/);
  assert.match(Q.SourceSearch, /type: SEARCH, page: 1/);
  assert.equal(res.more, true);
  assert.deepEqual(res.results[0], { id: '100', title: 'Lune', cover: '/suwayomi/api/v1/manga/100/thumbnail', sourceId: '1001', sourceLabel: 'MangaFixe', language: 'fr', inLibrary: false, reader: null, seriesId: null });
  assert.deepEqual(res.results[1], { id: '2', title: 'Café', cover: null, sourceId: '1001', sourceLabel: 'MangaFixe', language: 'fr', inLibrary: true, reader: 'suwayomi', seriesId: '2' });
  assert.doesNotThrow(() => normalizeSearch(k, res));
  sent.length = 0;
  await k.search('1001', 'autre');
  assert.deepEqual(sent.map((s) => s.op), ['SourceSearch'], 'the source list is not requested again');
});

await test('search(): a failing source throws, and the next search still works', async () => {
  handlers = { SourceSearch: ({ source }) => (source === '9' ? { errors: [{ message: 'Failed to connect' }], data: null } : { data: { fetchSourceManga: { hasNextPage: false, mangas: [] } } }),
    Sources: () => ({ data: { sources: { nodes: [node('9', 'Cassée', 'fr'), node('8', 'Bonne', 'fr')] } } }) };
  const k = collector();
  await assert.rejects(() => k.search('9', 'x'), /Failed to connect/);
  assert.deepEqual((await k.search('8', 'x')).results, []);
});

await test('search(): an unknown source is refused before any search is sent', async () => {
  sent.length = 0;
  handlers = { Sources: () => ({ data: { sources: { nodes: [node('1', 'A', 'fr')] } } }) };
  await assert.rejects(() => collector().search('404', 'x'), /inconnue/);
  assert.ok(!sent.some((s) => s.op === 'SourceSearch'));
});

await test('add(): updateManga with inLibrary, then fetchChapters; the reader caches are told; complete is true', async () => {
  sent.length = 0;
  handlers = {
    AddToLibrary: () => ({ data: { updateManga: { manga: { id: 100, inLibrary: true } } } }),
    FetchChapters: () => ({ data: { fetchChapters: { chapters: [{ id: 1 }] } } }),
  };
  const k = collector();
  let changes = 0;
  suwayomiClient(BASE).onChange(() => { changes++; });
  const added = await k.add('100');
  assert.deepEqual(sent.map((s) => [s.op, s.variables]), [['AddToLibrary', { id: 100 }], ['FetchChapters', { id: 100 }]]);
  assert.match(Q.AddToLibrary, /patch: \{ inLibrary: true \}/);
  assert.match(Q.FetchChapters, /fetchChapters\(input: \{ mangaId: \$id \}\)/);
  assert.deepEqual(added, { reader: 'suwayomi', seriesId: '100', complete: true });
  assert.ok(changes >= 1, 'listeners of the reader were notified');
  assert.doesNotThrow(() => normalizeAdded(k, added));
});

await test('add(): if the chapter list cannot be fetched, the series is still added and complete is false', async () => {
  handlers = {
    AddToLibrary: () => ({ data: { updateManga: { manga: { id: 7, inLibrary: true } } } }),
    FetchChapters: () => ({ errors: [{ message: 'source down' }], data: null }),
  };
  assert.deepEqual(await collector().add('7'), { reader: 'suwayomi', seriesId: '7', complete: false });
});

await test('add(): if adding itself fails, it throws and no chapter list is requested', async () => {
  sent.length = 0;
  handlers = { AddToLibrary: () => ({ errors: [{ message: 'nope' }], data: null }) };
  await assert.rejects(() => collector().add('7'), /nope/);
  assert.deepEqual(sent.map((s) => s.op), ['AddToLibrary']);
});

await test('pure mappers: a source without an icon or language, a result without a cover', () => {
  assert.deepEqual(toSource(BASE, { id: 5, name: 'X', lang: '', iconUrl: '', isNsfw: null }), { id: '5', label: 'X', language: null, nsfw: false, icon: null });
  const r = toResult(BASE, { id: '1', label: 'S', language: 'en' }, { id: 3, title: 'T', thumbnailUrl: null, inLibrary: false });
  assert.equal(r.cover, null);
  assert.equal(r.seriesId, null);
});

await test('every operation of the search uses only an operation name that matches its key (parsed by the syntax check)', () => {
  for (const key of ['Sources', 'SourceSearch', 'AddToLibrary', 'FetchChapters']) assert.match(Q[key], new RegExp(`(query|mutation) ${key}\\b`));
});

// ───────────── net.js : requêtes « isolées » ─────────────
const hangUntilAbort = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

await test('an isolated request that times out is an ApiError 408 and does not make the server look down', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = hangUntilAbort;
  try {
    await assert.rejects(() => net.send('iso-a', '/x', { timeout: 30, isolated: true }), (e) => e instanceof net.ApiError && e.status === 408);
    assert.ok(net.isServerReachable('iso-a'));
    // …alors qu'un délai ordinaire, lui, déclare le serveur injoignable.
    await assert.rejects(() => net.send('iso-b', '/x', { timeout: 30 }), net.OfflineError);
    assert.ok(!net.isServerReachable('iso-b'));
  } finally { globalThis.fetch = realFetch; net.forgetServer('iso-b'); }
});

await test('an isolated 504 is an ApiError; a plain 504 is an unreachable server', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 504 });
  try {
    await assert.rejects(() => net.send('iso-c', '/x', { isolated: true }), (e) => e instanceof net.ApiError && e.status === 504);
    assert.ok(net.isServerReachable('iso-c'));
    await assert.rejects(() => net.send('iso-d', '/x'), net.OfflineError);
    assert.ok(!net.isServerReachable('iso-d'));
  } finally { globalThis.fetch = realFetch; net.forgetServer('iso-d'); }
});

await test('an isolated request still reports a real network failure as an unreachable server', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network'); };
  try {
    await assert.rejects(() => net.send('iso-e', '/x', { isolated: true }), net.OfflineError);
    assert.ok(!net.isServerReachable('iso-e'));
  } finally { globalThis.fetch = realFetch; net.forgetServer('iso-e'); }
});

// ───────────── Choix des sources ─────────────
const src = (id, language, nsfw = false) => ({ id, label: 'S' + id, language, nsfw, icon: null });

await test('default selection: interface language or multilingual, never NSFW', () => {
  const list = [src('1', 'fr'), src('2', 'en'), src('3', 'all'), src('4', 'fr', true), src('5', 'fr-CA'), src('6', 'multi')];
  assert.deepEqual(ss.defaultSelection(list, 'fr'), ['1', '3', '5', '6']);
  assert.deepEqual(ss.defaultSelection(list, 'en'), ['2', '3', '6']);
});
await test('default selection: when no source speaks the interface language, every non-NSFW source', () => {
  assert.deepEqual(ss.defaultSelection([src('1', 'en'), src('2', 'ja'), src('3', 'en', true)], 'fr'), ['1', '2']);
  assert.deepEqual(ss.defaultSelection([src('3', 'en', true)], 'fr'), []);
  assert.deepEqual(ss.defaultSelection([], 'fr'), []);
});
await test('a saved choice wins over the default, ignores sources that no longer exist, and may be empty', () => {
  const list = [src('1', 'fr'), src('2', 'en'), src('4', 'fr', true)];
  assert.deepEqual(ss.selectedIds(list, ['2', '4', '99'], 'fr'), ['2', '4'], 'an NSFW source ticked by the user is kept');
  assert.deepEqual(ss.selectedIds(list, [], 'fr'), []);
  assert.deepEqual(ss.selectedIds(list, null, 'fr'), ['1']);
});
await test('the choice is kept per collector, survives bad storage and can be forgotten', () => {
  store.clear();
  assert.equal(ss.loadSaved('suwayomi'), null);
  ss.saveSelection('suwayomi', [1, 2]);
  ss.saveSelection('other', ['9']);
  assert.deepEqual(ss.loadSaved('suwayomi'), ['1', '2']);
  assert.deepEqual(ss.loadSaved('other'), ['9']);
  ss.forgetSelection('suwayomi');
  assert.equal(ss.loadSaved('suwayomi'), null);
  assert.deepEqual(ss.loadSaved('other'), ['9']);
  store.set('scrollarr.searchSources', '{not json');
  assert.equal(ss.loadSaved('other'), null);
  assert.doesNotThrow(() => ss.saveSelection('other', ['1']));
  assert.deepEqual(ss.loadSaved('other'), ['1']);
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
  try { assert.equal(ss.loadSaved('x'), null); assert.doesNotThrow(() => ss.saveSelection('x', ['1'])); } finally { globalThis.localStorage = real; }
});
await test('language labels', () => {
  assert.equal(ss.languageLabel('fr', 'Toutes'), 'FR');
  assert.equal(ss.languageLabel('all', 'Toutes'), 'Toutes');
  assert.equal(ss.languageLabel(null, 'Toutes'), '');
});

// ───────────── Parcours des sources ─────────────
const many = (n) => Array.from({ length: n }, (_, i) => src(String(i + 1), 'fr'));
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await test('searchEach: at most three searches at a time, every source searched once', async () => {
  let running = 0, peak = 0;
  const done = [];
  await ss.searchEach(many(8), 'q', async (s) => { running++; peak = Math.max(peak, running); await tick(15); running--; return { results: [s.id] }; }, { onSource: (s, o) => done.push([s.id, o.ok]) });
  assert.equal(peak, 3);
  assert.deepEqual(done.map((d) => d[0]).sort(), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.ok(done.every((d) => d[1]));
});
await test('searchEach: the concurrency can be lowered to one source at a time', async () => {
  let running = 0, peak = 0;
  await ss.searchEach(many(4), 'q', async () => { running++; peak = Math.max(peak, running); await tick(5); running--; return {}; }, { concurrency: 1 });
  assert.equal(peak, 1);
});
await test('searchEach: a failing source is reported on its own and the others still answer', async () => {
  const out = new Map();
  await ss.searchEach(many(5), 'q', async (s) => { if (s.id === '2' || s.id === '4') throw new Error('boom ' + s.id); return { results: [s.id], more: false }; }, { onSource: (s, o) => out.set(s.id, o) });
  assert.deepEqual([...out].filter(([, o]) => !o.ok).map(([id]) => id), ['2', '4']);
  assert.equal(out.get('2').error.message, 'boom 2');
  assert.deepEqual(out.get('3'), { ok: true, results: ['3'], more: false });
  assert.equal(out.size, 5);
});
await test('searchEach: onStart is called before each search, in order of the list', async () => {
  const log = [];
  await ss.searchEach(many(3), 'q', async (s) => { log.push('search ' + s.id); return {}; }, { concurrency: 1, onStart: (s) => log.push('start ' + s.id) });
  assert.deepEqual(log, ['start 1', 'search 1', 'start 2', 'search 2', 'start 3', 'search 3']);
});
await test('searchEach: when the server itself is unreachable, sources not yet started are skipped, not searched', async () => {
  const calls = [];
  const out = new Map();
  await ss.searchEach(many(6), 'q', async (s) => { calls.push(s.id); if (s.id === '1') throw new net.OfflineError('down'); await tick(10); return {}; },
    { concurrency: 1, stopWhen: (e) => e instanceof net.OfflineError, onSource: (s, o) => out.set(s.id, o) });
  assert.deepEqual(calls, ['1']);
  assert.equal(out.get('1').ok, false);
  assert.deepEqual([...out.keys()], ['1', '2', '3', '4', '5', '6']);
  assert.ok(['2', '3', '4', '5', '6'].every((id) => out.get(id).skipped === true));
});
await test('searchEach: once cancelled it starts nothing more and reports nothing more', async () => {
  let cancelled = false;
  const calls = [];
  const reported = [];
  await ss.searchEach(many(6), 'q', async (s) => { calls.push(s.id); await tick(10); if (s.id === '2') cancelled = true; return {}; },
    { concurrency: 1, cancelled: () => cancelled, onSource: (s) => reported.push(s.id) });
  assert.deepEqual(calls, ['1', '2']);
  assert.deepEqual(reported, ['1']);
});
await test('searchEach: no sources, nothing happens', async () => {
  await ss.searchEach([], 'q', async () => { throw new Error('never'); }, { onSource: () => { throw new Error('never'); } });
});

// ───────────── Façade, avec un collecteur d'essai ─────────────
const { READERS, COLLECTORS } = await import('../app/js/connectors/index.js');
const fn = () => {};
const calls = [];
function makeReader(id, code) {
  return {
    id, code, label: id, userLabel: 'User', capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ],
    ...Object.fromEntries(['login', 'logout', 'libraries', 'genres', 'seriesNew', 'seriesUpdated', 'series', 'seriesBooks', 'booksLatest', 'booksOnDeck',
      'booksInProgress', 'booksRecentlyRead', 'book', 'bookPages', 'nextBook', 'previousBook', 'seriesThumb', 'bookThumb'].map((m) => [m, fn])),
    session: async () => ({ name: 'tester' }),
    seriesList: async () => { calls.push(['seriesList', id]); return { content: [{ id: 's1', name: id + ' series', booksCount: 1, metadata: { title: id + ' series' } }], last: true }; },
  };
}
READERS.length = 0;
READERS.push({ id: 'plain', path: 'plain', create: () => makeReader('plain', 'p') }, { id: 'other', path: 'other', create: () => makeReader('other', 'o') });
COLLECTORS.length = 0;
const added = [];
let searchResult = { results: [], more: false };
let addResult = { reader: 'plain', seriesId: '42', complete: true };
COLLECTORS.push({ id: 'seeker', path: 'seeker', create: () => ({
  id: 'seeker', label: 'Seeker', serves: ['plain'], session: 'plain',
  capabilities: [CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH, CAP.COLLECT_ADD],
  sources: async () => [{ id: 'a', label: 'A', language: 'fr', nsfw: false, icon: null }],
  search: async (sourceId, query) => { calls.push(['search', sourceId, query]); return searchResult; },
  add: async (id) => { added.push(id); return addResult; },
}) });
COLLECTORS.push({ id: 'plainc', path: 'plainc', create: () => ({ id: 'plainc', label: 'Plain', serves: ['plain'], session: 'plain', capabilities: [CAP.COLLECT_CHAPTERS], collectChapters: fn }) });

const api = await import('../app/js/api.js');
await api.init();
await api.connect();

await test('facade: a collector that can search is found; one that only downloads is not', () => {
  assert.equal(api.canSearchSources(), true);
  assert.deepEqual(api.searchCollector(), { id: 'seeker', label: 'Seeker' });
  assert.equal(api.canSearchNow(), true);
});
await test('facade: results carry the facade-prefixed series id when already in the library', async () => {
  searchResult = { more: true, results: [
    { id: '1', title: 'A', cover: null, sourceId: 'a', sourceLabel: 'A', language: 'fr', inLibrary: true, reader: 'plain', seriesId: '12' },
    { id: '2', title: 'B', cover: '/seeker/c.png', sourceId: 'a', sourceLabel: 'A', language: 'fr', inLibrary: false, reader: null, seriesId: null },
  ] };
  const res = await api.searchSource('a', 'abc');
  assert.deepEqual(calls.at(-1), ['search', 'a', 'abc']);
  assert.equal(res.more, true);
  assert.equal(res.results[0].seriesId, 'p:12');
  assert.equal(res.results[0].collector, 'seeker');
  assert.equal(res.results[1].seriesId, null);
});
await test('facade: a malformed result from a collector is refused, not displayed', async () => {
  searchResult = { results: [{ id: '1', title: '', cover: null, sourceId: 'a', sourceLabel: 'A', language: 'fr', inLibrary: false, reader: null, seriesId: null }] };
  await assert.rejects(() => api.searchSource('a', 'abc'), /title/);
  searchResult = { results: [{ id: '1', title: 'T', cover: 'https://elsewhere.example/c.png', sourceId: 'a', sourceLabel: 'A', language: 'fr', inLibrary: false, reader: null, seriesId: null }] };
  await assert.rejects(() => api.searchSource('a', 'abc'), /cover/);
});
await test('facade: the sources list comes from the collector, validated', async () => {
  const list = await api.sources();
  assert.deepEqual(list, [{ id: 'a', label: 'A', language: 'fr', nsfw: false, icon: null }]);
});
await test('facade: adding returns the prefixed series, and empties the merged-library memory so the series appears', async () => {
  // Deux serveurs actifs : la liste fusionnée est gardée en mémoire quelques secondes.
  calls.length = 0;
  const reads = () => calls.filter((c) => c[0] === 'seriesList').length;
  await api.seriesList({ search: 'x' });
  const first = reads();
  await api.seriesList({ search: 'x' });
  assert.equal(reads(), first, 'the second call is served from memory');
  const res = await api.addFromSource({ id: '77', collector: 'seeker' });
  assert.deepEqual(added, ['77']);
  assert.deepEqual(res, { seriesId: 'p:42', complete: true });
  await api.seriesList({ search: 'x' });
  assert.ok(reads() > first, 'the library is read again after the add');
});
await test('facade: a collector with no common ids adds without any series to open', async () => {
  addResult = { reader: null, seriesId: null, complete: true };
  assert.deepEqual(await api.addFromSource({ id: '5', collector: 'seeker' }), { seriesId: null, complete: true });
  addResult = { reader: 'other', seriesId: '1', complete: true };
  await assert.rejects(() => api.addFromSource({ id: '6', collector: 'seeker' }), /serves/);
});
await test('facade: adding with an unknown or non-adding collector is refused', async () => {
  await assert.rejects(() => api.addFromSource({ id: '1', collector: 'nope' }), /impossible/);
  await assert.rejects(() => api.addFromSource({ id: '1', collector: 'plainc' }), /impossible/);
});
await test('facade: offline, searching is not offered', () => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  assert.equal(api.canSearchSources(), true);
  assert.equal(api.canSearchNow(), false);
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  assert.equal(api.canSearchNow(), true);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll search and add unit tests passed');
process.exit(failed ? 1 : 0);
