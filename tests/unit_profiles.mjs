// Unit tests for app/js/profiles.js (flush and list merge) with test-only readers. No browser.
// Run with: node tests/unit_profiles.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); } catch { /* déjà défini */ }
globalThis.fetch = async (url) => {
  if (String(url).endsWith('servers.json')) return { ok: true, json: async () => ({ nostore: true, good: true, good2: true }) };
  throw new TypeError('network');
};
// Le profil actif est un profil secondaire : l'historique passe par la surcouche testée.
const seedStorage = () => {
  store.clear();
  localStorage.setItem('scrollarr.profile', 'p1');
  localStorage.setItem('scrollarr.profiles.cache', JSON.stringify([{ id: 'main', name: 'Principal' }, { id: 'p1', name: 'Duo' }]));
};
seedStorage();

const { CAP } = await import('../app/js/connectors/contract.js');
const { READERS } = await import('../app/js/connectors/index.js');

const docsOf = { nostore: {}, good: {}, good2: {} };
const calls = { good: { get: 0, set: 0 }, good2: { get: 0, set: 0 }, nostore: { get: 0, set: 0 } };
let goodDown = false;
let goodDelay = 0;
function makeReader(id, code, withStore) {
  const fn = () => {};
  const { OfflineError } = globalThis.__net;
  return {
    id, code, label: id, userLabel: 'User',
    capabilities: [CAP.SERIES_LIST, CAP.CHAPTER_READ, CAP.PROGRESS_WRITE, ...(withStore ? [CAP.SETTINGS_STORE] : [])],
    ...Object.fromEntries(['login', 'logout', 'libraries', 'genres', 'seriesList', 'seriesNew', 'seriesUpdated', 'series', 'seriesBooks',
      'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead', 'bookPages', 'nextBook', 'previousBook',
      'seriesThumb', 'bookThumb', 'saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread'].map((m) => [m, fn])),
    session: async () => ({ name: 'tester' }),
    book: async (raw) => ({ id: raw, seriesId: 'ser' + raw[0], name: 'Ch ' + raw, media: { pagesCount: 3 }, metadata: {} }),
    ...(withStore ? {
      getSettings: async (prefix) => {
        calls[id].get++;
        if (id === 'good' && goodDown) throw new OfflineError('down');
        return Object.fromEntries(Object.entries(docsOf[id]).filter(([k]) => k.startsWith(prefix)));
      },
      setSetting: async (k, v) => {
        calls[id].set++;
        if (id === 'good' && goodDown) throw new OfflineError('down');
        if (id === 'good' && goodDelay) await new Promise((r) => setTimeout(r, goodDelay));
        docsOf[id][k] = v;
      },
      deleteSettings: async () => {},
    } : {}),
  };
}
globalThis.__net = await import('../app/js/net.js');
// « nostore » est placé avant « good » : son document passe en tête de la file d'envoi.
READERS.push({ id: 'nostore', path: 'nostore', create: () => makeReader('nostore', 'n', false) });
READERS.push({ id: 'good', path: 'good', create: () => makeReader('good', 'g', true) });
READERS.push({ id: 'good2', path: 'good2', create: () => makeReader('good2', 'h', true) });

const api = await import('../app/js/api.js');
const profiles = await import('../app/js/profiles.js');
await api.init();
await api.connect();
await profiles.load(); // active la surcouche du profil p1

let failed = 0;
async function test(name, run) {
  try { await run(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mirrored = () => JSON.parse(localStorage.getItem('scrollarr.pmirror.p1') || '{"dirty":[]}').dirty;

await test('a document that cannot be stored does not block the other servers', async () => {
  await api.saveProgress('n:1', 3, true);     // serveur sans stockage : écrit en premier, échoue toujours
  await api.saveProgress('g:1', 3, true);
  await sleep(2000);                          // le 1er envoi (serveur sans stockage) était déjà parti : reprise après 1,5 s
  const written = Object.keys(docsOf.good);
  assert.ok(written.some((k) => k.endsWith('idx')), 'good server received its index: ' + written);
  assert.ok(written.some((k) => k.includes('.s.')), 'good server received its series document: ' + written);
});
await test('the failed documents stay dirty, the delivered ones are cleared', () => {
  const dirty = mirrored();
  assert.ok(dirty.length > 0 && dirty.every((x) => x.startsWith('nostore|')), JSON.stringify(dirty));
});
await test('no retry loop after a failure', async () => {
  const before = calls.good.get + calls.nostore.get;
  await sleep(2200);                          // plus que le délai de reprise de 1,5 s
  assert.equal(calls.good.get + calls.nostore.get, before);
});
await test('a later change retries the failed document too, without blocking the new one', async () => {
  await api.saveProgress('g:2', 3, true);
  await sleep(150);
  assert.ok(Object.values(docsOf.good).some((v) => v.includes('"2"')), 'new chapter delivered');
  assert.ok(mirrored().every((x) => x.startsWith('nostore|')));
});
await test('offline: every document fails, stays dirty, and nothing loops', async () => {
  goodDown = true;
  await api.saveProgress('g:3', 3, true);
  await sleep(150);
  assert.ok(mirrored().some((x) => x.startsWith('good|')), JSON.stringify(mirrored()));
  const before = calls.good.get;
  await sleep(2200);
  assert.equal(calls.good.get, before);
  goodDown = false;
});
await test('a change made during a slow write is kept for the next pass', async () => {
  goodDelay = 300;
  await api.saveProgress('g:4', 1, false);    // page tournée : part avec le délai normal ; on force l'envoi
  await api.saveProgress('g:4', 3, true);     // terminé : envoi immédiat, lent
  await sleep(100);
  await api.saveProgress('g:4', 2, false);    // modifié pendant l'écriture
  await sleep(2600);
  goodDelay = 0;
  const idx = JSON.parse(Object.entries(docsOf.good).find(([k]) => k.endsWith('idx'))[1]);
  assert.ok(idx.r.some((e) => e.b === 'g:4'));
  assert.ok(!mirrored().some((x) => x.startsWith('good|')), JSON.stringify(mirrored()));
});

// ───────────── Liste des profils ─────────────
const LIST = 'scrollarr.profiles';
const MAIN = { id: 'main', name: 'Principal' };
const idsNow = () => profiles.list().map((p) => p.id);
const onServer = (id) => JSON.parse(docsOf[id][LIST]).map((p) => p.id + (p.del ? '!' : ''));
api.setPrimary('good');   // le serveur « prioritaire » est celui qui peut être en retard

await test('list: a stale priority server does not make a profile disappear, and is brought up to date', async () => {
  docsOf.good[LIST] = JSON.stringify([MAIN]);                                              // en retard : ne connaît pas p1
  docsOf.good2[LIST] = JSON.stringify([MAIN, { id: 'p1', name: 'Duo' }, { id: 'pz', name: 'Ailleurs', added: 5, rev: 1, dev: 'zz' }]);
  await profiles.load();
  assert.deepEqual(idsNow(), ['main', 'p1', 'pz']);            // p1 (local) et pz (créé ailleurs) sont là
  assert.deepEqual(onServer('good'), ['main', 'p1', 'pz']);
  assert.deepEqual(JSON.parse(localStorage.getItem('scrollarr.profiles.cache')).map((p) => p.id), ['main', 'p1', 'pz']);
});
await test('list: a profile removed on purpose stays removed against a stale server', async () => {
  await profiles.remove('pz');
  assert.deepEqual(idsNow(), ['main', 'p1']);
  docsOf.good2[LIST] = JSON.stringify([MAIN, { id: 'p1', name: 'Duo' }, { id: 'pz', name: 'Ailleurs', added: 5, rev: 1, dev: 'zz' }]);  // copie périmée
  await profiles.load();
  assert.deepEqual(idsNow(), ['main', 'p1']);
  assert.deepEqual(onServer('good2'), ['main', 'p1', 'pz!']);  // la marque est recopiée
});
await test('list: creating a profile keeps the ones created elsewhere in the meantime', async () => {
  docsOf.good[LIST] = docsOf.good2[LIST] = JSON.stringify([MAIN, { id: 'p1', name: 'Duo' }, { id: 'pq', name: 'Autre appareil', added: 7, rev: 1, dev: 'qq' }]);
  const made = await profiles.create('Neuf');
  assert.deepEqual(idsNow(), ['main', 'p1', 'pq', made.id]);
  for (const id of ['good', 'good2']) assert.deepEqual(onServer(id).filter((x) => !x.endsWith('!')), ['main', 'p1', 'pq', made.id], id);
});
await test('list: old lists without stamps still load', async () => {
  docsOf.good[LIST] = docsOf.good2[LIST] = JSON.stringify([MAIN, { id: 'p1', name: 'Duo' }, { id: 'p9', name: 'Ancien' }]);
  await profiles.load();
  assert.ok(idsNow().includes('p9') && idsNow().includes('p1'));
});
await test('list: rename wins over a stale copy and the main profile cannot be removed', async () => {
  await profiles.rename('p9', 'Renommé');
  await profiles.load();
  assert.equal(profiles.list().find((p) => p.id === 'p9').name, 'Renommé');
  await profiles.remove('main');
  assert.ok(idsNow().includes('main'));
});
await test('list: offline, the known list is kept', async () => {
  goodDown = true; docsOf.good2[LIST] = 'not json';
  const before = idsNow();
  await profiles.load();
  assert.deepEqual(idsNow(), before);
  goodDown = false;
});

// ───────────── Nom du profil principal (interface en français ici ; l'anglais est dans unit_profile_name.mjs) ─────────────
await test('main name: the default name is shown in French and stays "Principal" in the stored list', async () => {
  docsOf.good[LIST] = docsOf.good2[LIST] = JSON.stringify([MAIN, { id: 'p1', name: 'Duo' }]);
  await profiles.load();
  const main = profiles.list().find((p) => p.id === 'main');
  assert.equal(main.name, 'Principal');
  assert.equal(profiles.displayName(main), 'Principal');
  assert.equal(profiles.displayName({ id: 'p1', name: 'Principal' }), 'Principal'); // un autre profil : jamais traduit, quel que soit son nom
});
await test('main name: a custom name is kept, stored, and shown as is', async () => {
  await profiles.rename('main', '  Papa ');
  const main = profiles.list().find((p) => p.id === 'main');
  assert.equal(main.name, 'Papa');
  assert.equal(profiles.displayName(main), 'Papa');
  assert.equal(JSON.parse(docsOf.good[LIST]).find((p) => p.id === 'main').name, 'Papa');
  await profiles.rename('main', 'Principal'); // retour au nom par défaut
  assert.equal(profiles.displayName(profiles.list().find((p) => p.id === 'main')), 'Principal');
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll profile unit tests passed');
process.exit(failed ? 1 : 0);
