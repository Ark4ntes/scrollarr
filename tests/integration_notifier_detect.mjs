// Intégration du notifier (partie « détection ») : ce qui déclenche une notification et ce qui n'en déclenche pas.
// Le vrai service (PUSH_DRY_RUN=1, vérification toutes les 3 s) surveille les faux Suwayomi et Komga ; les chapitres
// arrivent à la demande (…/__mock/add-chapter, …/__mock/add-book) ; la charge utile se lit dans les lignes « PUSH ».
// Lancer avec : node tests/integration_notifier_detect.mjs   (après « npm ci » dans notifier/)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  suite, startMock, startNotifier, tmp, sleep, fakeSubscription, komgaCookie, suwayomiBasicCookie, suwayomiTokenCookie,
} from './_notifier.mjs';

const { test, run } = suite('notifier detection');
const stoppers = [];
const own = (x) => { stoppers.push(x); return x; };
const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

/** La charge utile que lit le service worker : title, body, tag, path — des chaînes, rien d'autre. */
function assertShape(payload) {
  assert.deepEqual(Object.keys(payload).sort(), ['body', 'path', 'tag', 'title']);
  for (const v of Object.values(payload)) assert.ok(typeof v === 'string' && v.length > 0, JSON.stringify(payload));
  assert.match(payload.path, /^\/(series\/[sk]:[^\s/]+|my\/subscriptions)$/, 'chemin que le routeur de l\'application sait ouvrir');
}
const series = (id, title, body) => ({ title, body, tag: 'series-' + id, path: '/series/' + id });
/** « Une vérification s'achève, on agit, la suivante voit le résultat » : les chapitres arrivent donc toujours dans la même vérification. */
async function afterPoll(n, act) { await n.polled(1); await act(); await n.polled(1); }
const lines = (n, from = 0) => n.pushes().slice(from).map((p) => `${p.userId} ${JSON.stringify(p.payload)}`);

// ───────────── Scénario principal : Suwayomi (basic) et Komga ensemble ─────────────
const dataDir = tmp();
const mock = own(await startMock({ auth: 'basic', servers: 'suwayomi,komga' }));
const env = { SUWAYOMI_URL: mock.suwayomiUrl, SUWAYOMI_USER: 'demo', SUWAYOMI_PASSWORD: 'demo', KOMGA_URL: mock.komgaUrl, KOMGA_API_KEY: 'demo-key' };
const alice = { cookie: await komgaCookie(mock) };   // komga:U1
const bob = { cookie: suwayomiBasicCookie() };       // suwayomi
const devices = {
  a1: { ...fakeSubscription('https://push.example.test/a1'), who: alice, lang: 'en', favorites: ['s:1', 'k:S001', 's:100'] },
  a2: { ...fakeSubscription('https://push.example.test/a2'), who: alice, lang: 'fr', favorites: ['s:1'] },
  b1: { ...fakeSubscription('https://push.example.test/b1'), who: bob, lang: 'en', favorites: ['s:2'] },
  gone: { ...fakeSubscription('https://push.example.test/gone'), who: bob, lang: 'en', favorites: ['s:1', 's:3'] },
};
// Les abonnements existent déjà au premier démarrage : la première vérification ne doit rien leur annoncer.
writeFileSync(join(dataDir, 'subscriptions.json'), JSON.stringify(Object.fromEntries(Object.values(devices).map((d) => [d.endpoint, {
  subscription: { endpoint: d.endpoint, keys: d.keys }, userId: d.who === alice ? 'komga:U1' : 'suwayomi', favorites: d.favorites, lang: d.lang,
}]))));
let n = own(await startNotifier({ dataDir, env }));
const sub = (d, extra = {}) => n.post('/subscribe', { subscription: { endpoint: d.endpoint, keys: d.keys }, favorites: d.favorites, lang: d.lang, ...extra }, d.who);

test('the first check only records what exists: nothing is announced, even to devices that follow existing series', async () => {
  assert.equal((await n.call('GET', '/health')).json.subscriptions, 4, 'abonnements relus au démarrage');
  await n.settle();
  assert.deepEqual(lines(n), []);
  const seen = readJson(dataDir, 'seen.json');
  assert.deepEqual(Object.keys(seen.baseline).sort(), ['komga', 'suwayomi']);
  assert.ok(seen.ids.length > 150, 'les chapitres existants sont mémorisés : ' + seen.ids.length);
  assert.ok(seen.ids.some((id) => id.startsWith('s:1.')) && seen.ids.some((id) => id.startsWith('k:')));
});
test('an unsubscribed device is not notified (checked in the next tests); unsubscribing is by the owner', async () => {
  assert.equal((await n.post('/unsubscribe', { endpoint: devices.gone.endpoint }, devices.gone.who)).status, 200);
  assert.equal((await n.call('GET', '/health')).json.subscriptions, 3);
});
test('a chapter added to a followed series: exactly one notification per subscribed device, with the expected payload', async () => {
  const from = n.pushes().length;
  await afterPoll(n, () => mock.addChapter(1));
  const got = n.pushes().slice(from);
  assert.deepEqual(got.map((p) => p.userId), ['komga:U1', 'komga:U1'], 'les deux appareils d\'Alice, personne d\'autre');
  assert.deepEqual(got[0].payload, series('s:1', 'Les Veilleurs de Brume', 'New chapter: Chapitre 39'));
  assert.deepEqual(got[1].payload, series('s:1', 'Les Veilleurs de Brume', 'Nouveau chapitre : Chapitre 39'), 'dans la langue de l\'appareil');
  got.forEach((p) => assertShape(p.payload));
});
test('nothing is announced twice: later checks with no change send nothing', async () => {
  const from = n.pushes().length;
  await n.polled(3);
  assert.equal(n.pushes().length, from);
  assert.equal(n.pushes().length, 2);
});
test('several chapters in one series arrive together: one notification with their number; an unfollowed series: none; two series at once: one each', async () => {
  const from = n.pushes().length;
  await afterPoll(n, async () => {
    for (let i = 0; i < 3; i++) await mock.addChapter(2);   // suivie par Bob
    await mock.addChapter(4);                                // suivie par personne (ni sur le disque, ni abonnée)
    await mock.addChapter(1);                                // suivie par Alice
  });
  const got = n.pushes().slice(from);
  assert.deepEqual(got.map((p) => [p.userId, p.payload.tag]).sort(), [['komga:U1', 'series-s:1'], ['komga:U1', 'series-s:1'], ['suwayomi', 'series-s:2']]);
  const bobs = got.find((p) => p.userId === 'suwayomi');
  assert.deepEqual(bobs.payload, series('s:2', 'Café Lune Rouge', '3 new chapters'));
  assert.ok(got.filter((p) => p.userId === 'komga:U1').every((p) => p.payload.body.endsWith('Chapitre 40')), JSON.stringify(got));
  got.forEach((p) => assertShape(p.payload));
  assert.equal(got.filter((p) => p.payload.tag === 'series-s:4').length, 0);
});
test('changing the followed series takes effect at the next check; unsubscribing a device stops its notifications', async () => {
  // Bob suit aussi la série 1 ; le deuxième appareil d'Alice se désabonne.
  devices.b1.favorites = ['s:1'];
  assert.equal((await sub(devices.b1)).status, 200);
  assert.equal((await n.post('/unsubscribe', { endpoint: devices.a2.endpoint }, alice)).status, 200);
  const from = n.pushes().length;
  await afterPoll(n, () => mock.addChapter(1));
  assert.deepEqual(n.pushes().slice(from).map((p) => [p.userId, p.payload.body]).sort(), [['komga:U1', 'New chapter: Chapitre 41'], ['suwayomi', 'New chapter: Chapitre 41']]);
  // Bob ne suit plus rien : plus aucune notification pour lui.
  devices.b1.favorites = [];
  await sub(devices.b1);
  const next = n.pushes().length;
  await afterPoll(n, async () => { await mock.addChapter(1); await mock.addChapter(2); });
  assert.deepEqual(n.pushes().slice(next).map((p) => p.userId), ['komga:U1']);
});
test('Komga: a book added to a followed series is announced with the Komga identifiers; several give a count', async () => {
  const from = n.pushes().length;
  await afterPoll(n, () => mock.addBook('S001'));
  const one = n.pushes().slice(from);
  assert.equal(one.length, 1);
  assert.equal(one[0].userId, 'komga:U1');
  assert.deepEqual(one[0].payload, series('k:S001', 'Les Veilleurs de Brume', 'New chapter: Chapitre 39'));
  assertShape(one[0].payload);
  const next = n.pushes().length;
  await afterPoll(n, async () => { await mock.addBook('S001'); await mock.addBook('S001'); await mock.addBook('S002'); });
  const two = n.pushes().slice(next);
  assert.deepEqual(two.map((p) => p.payload), [series('k:S001', 'Les Veilleurs de Brume', '2 new chapters')]);
});
test('a series added to the library after the baseline: only its freshly fetched chapter is announced, not its whole backlog', async () => {
  const gql = (operationName, variables) => fetch(mock.suwayomiUrl + '/api/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('demo:demo').toString('base64') },
    body: JSON.stringify({ operationName, variables }),
  }).then((r) => r.json());
  const found = await gql('SourceSearch', { source: '1001', query: 'Lune d’Acier' });
  const id = found.data.fetchSourceManga.mangas[0].id;
  assert.equal(id, 100);
  const from = n.pushes().length;
  await afterPoll(n, async () => { await gql('AddToLibrary', { id }); await gql('FetchChapters', { id }); }); // 12 chapitres, 11 datent de plusieurs jours
  assert.deepEqual(n.pushes().slice(from).map((p) => p.payload), [series('s:100', 'Lune d’Acier', 'New chapter: Chapitre 12')]);
});
test('restart: a chapter that arrived while the service was stopped is announced once; a second restart announces nothing', async () => {
  await n.stop();
  await mock.addChapter(1);
  n = own(await startNotifier({ dataDir, env }));
  await n.settle();
  assert.deepEqual(n.pushes().map((p) => [p.userId, p.payload.tag, p.payload.body]), [['komga:U1', 'series-s:1', 'New chapter: Chapitre 43']]);
  await n.stop();
  n = own(await startNotifier({ dataDir, env }));
  await n.settle();
  assert.deepEqual(n.pushes(), []);
});
test('restart without its "seen" file: the existing library is recorded again, nothing is announced', async () => {
  await n.stop();
  rmSync(join(dataDir, 'seen.json'));
  n = own(await startNotifier({ dataDir, env }));
  await n.settle();
  assert.deepEqual(n.pushes(), []);
  await afterPoll(n, () => mock.addChapter(1));
  assert.equal(n.pushes().length, 1, 'puis le service annonce de nouveau');
  await n.stop();
});

// ───────────── Servers down ─────────────
test('servers that fail during a check: the service keeps running, announces nothing false, and announces a missed chapter once they are back', async () => {
  const dir = tmp();
  const m = own(await startMock({ auth: 'none', servers: 'suwayomi,komga' }));
  const cookie = await komgaCookie(m);
  const x = own(await startNotifier({ dataDir: dir, env: { SUWAYOMI_URL: m.suwayomiUrl, KOMGA_URL: m.komgaUrl, KOMGA_API_KEY: 'demo-key' } }));
  await x.post('/subscribe', { subscription: { endpoint: 'https://push.example.test/down', keys: fakeSubscription('x').keys }, favorites: ['s:1', 'k:S001'], lang: 'en' }, { cookie });
  await x.settle();
  await x.polled(1);
  await m.addChapter(1); await m.addBook('S001');
  await m.outage('deny');
  await x.settle();
  assert.equal(x.child.exitCode, null, 'le service tourne toujours');
  assert.deepEqual(x.pushes(), [], 'rien tant que les serveurs répondent par un refus');
  assert.ok(x.log.some((l) => l.includes('Vérification de suwayomi impossible')) && x.log.some((l) => l.includes('Vérification de komga impossible')), x.log.join('|'));
  assert.equal((await x.call('GET', '/health')).status, 200);
  await m.outage('off');
  await x.settle();
  await x.polled(2);
  assert.deepEqual(x.pushes().map((p) => p.payload.tag).sort(), ['series-k:S001', 'series-s:1'], 'chacun une seule fois');
  await x.stop(); await m.stop();
});
test('a server that restarts (connection refused, then back with the same library): no false notification', async () => {
  const m = own(await startMock({ auth: 'none', servers: 'suwayomi,komga' }));
  const cookie = await komgaCookie(m);
  const x = own(await startNotifier({ env: { SUWAYOMI_URL: m.suwayomiUrl, KOMGA_URL: m.komgaUrl, KOMGA_API_KEY: 'demo-key' } }));
  await x.post('/subscribe', { subscription: { endpoint: 'https://push.example.test/restart', keys: fakeSubscription('x').keys }, favorites: ['s:1', 's:2', 'k:S001'], lang: 'en' }, { cookie });
  await x.settle();
  await m.stop();
  await x.settle();
  assert.ok(x.log.some((l) => l.includes('impossible')), 'les vérifications échouent : ' + x.log.join('|'));
  const back = own(await startMock({ auth: 'none', servers: 'suwayomi,komga', port: m.port }));
  await x.settle();
  await x.polled(1);
  assert.deepEqual(x.pushes(), [], 'les mêmes chapitres, rien de nouveau');
  await back.addChapter(2);
  await x.settle();
  assert.deepEqual(x.pushes().map((p) => p.payload.tag), ['series-s:2'], 'et le service surveille toujours');
  await x.stop(); await back.stop();
});
test('a server that is down at the very first check: the library it then reveals is recorded, not announced', async () => {
  const m = own(await startMock({ auth: 'none', servers: 'suwayomi,komga' }));
  await m.outage('deny');
  const dir = tmp();
  writeFileSync(join(dir, 'subscriptions.json'), JSON.stringify({ 'https://push.example.test/late': {
    subscription: { endpoint: 'https://push.example.test/late', keys: fakeSubscription('x').keys }, userId: 'suwayomi', favorites: ['s:1', 'k:S001'], lang: 'en' } }));
  const x = own(await startNotifier({ dataDir: dir, env: { SUWAYOMI_URL: m.suwayomiUrl, KOMGA_URL: m.komgaUrl, KOMGA_API_KEY: 'demo-key' } }));
  await x.settle();
  assert.deepEqual(readJson(dir, 'seen.json').baseline, {}, 'aucun point de départ sans réponse');
  await m.outage('off');
  await x.settle();
  assert.deepEqual(x.pushes(), [], 'l\'existant n\'est pas annoncé');
  assert.deepEqual(Object.keys(readJson(dir, 'seen.json').baseline).sort(), ['komga', 'suwayomi']);
  await afterPoll(x, async () => { await m.addChapter(1); await m.addBook('S001'); });
  assert.deepEqual(x.pushes().map((p) => p.payload.tag).sort(), ['series-k:S001', 'series-s:1']);
  await x.stop(); await m.stop();
});

// ───────────── Identifiants du service ─────────────
const modeCases = [
  { auth: 'none', user: false, cookie: async () => 'x=1' },
  { auth: 'basic', user: true, cookie: async () => suwayomiBasicCookie() },
  { auth: 'simple', user: true, cookie: async () => suwayomiBasicCookie() },
  { auth: 'ui', user: true, cookie: (m) => suwayomiTokenCookie(m), mockEnv: { SUWA_TOKEN_TTL: '2' } }, // le jeton du service expire entre deux vérifications (3 s)
];
test('Suwayomi: the service reads the library in each authentication mode with its own credentials (token renewed when it expires)', async () => {
  await Promise.all(modeCases.map(async ({ auth, user, cookie, mockEnv }) => {
    const m = own(await startMock({ auth, servers: 'suwayomi', env: mockEnv }));
    const x = own(await startNotifier({ env: { SUWAYOMI_URL: m.suwayomiUrl, ...(user ? { SUWAYOMI_USER: 'demo', SUWAYOMI_PASSWORD: 'demo' } : {}) } }));
    const r = await x.post('/subscribe', { subscription: { endpoint: 'https://push.example.test/' + auth, keys: fakeSubscription('x').keys }, favorites: ['s:1'], lang: 'en' }, { cookie: await cookie(m) });
    assert.equal(r.status, 200, auth);
    await x.settle();
    assert.deepEqual(x.pushes(), [], auth);
    await afterPoll(x, () => m.addChapter(1));
    assert.deepEqual(x.pushes().map((p) => [p.userId, p.payload.tag, p.payload.body]), [['suwayomi', 'series-s:1', 'New chapter: Chapitre 39']], `${auth}: ${x.log.join('|')}`);
    if (auth === 'ui') { // un second chapitre, après l'expiration du jeton obtenu par le service
      await sleep(2500);
      await afterPoll(x, () => m.addChapter(1));
      assert.equal(x.pushes().length, 2, 'ui : ' + x.log.join('|'));
      assert.ok((await m.requests()).filter((o) => o === 'Login').length >= 2, 'le service s\'est reconnecté');
    }
    await x.stop(); await m.stop();
  }));
});
test('Suwayomi that needs credentials the service does not have (or has wrong): a clear warning at every check, no crash, no announcement', async () => {
  const cases = [];
  for (const [label, extra] of [['no credentials', {}], ['wrong password', { SUWAYOMI_USER: 'demo', SUWAYOMI_PASSWORD: 'faux' }]]) {
    for (const auth of ['basic', 'ui']) cases.push([label, extra, auth]);
  }
  await Promise.all(cases.map(async ([label, extra, auth]) => {
    const m = own(await startMock({ auth, servers: 'suwayomi' }));
    const x = own(await startNotifier({ env: { SUWAYOMI_URL: m.suwayomiUrl, ...extra } }));
    await x.polled(2);
    assert.equal(x.child.exitCode, null, `${auth} ${label}`);
    assert.ok(x.log.some((l) => l.startsWith('Vérification de suwayomi impossible') && l.includes('SUWAYOMI_USER')), `${auth} ${label} : ${x.log.join('|')}`);
    assert.deepEqual(x.pushes(), []);
    assert.deepEqual(readJson(x.dataDir, 'seen.json').baseline, {});
    await x.stop(); await m.stop();
  }));
});
test('Komga: the API key is what lets the service read; a wrong key gives a warning and nothing else', async () => {
  const m = own(await startMock({ auth: 'none', servers: 'komga' }));
  const cookie = await komgaCookie(m);
  const good = own(await startNotifier({ env: { KOMGA_URL: m.komgaUrl, KOMGA_API_KEY: 'demo-key' } }));
  const bad = own(await startNotifier({ env: { KOMGA_URL: m.komgaUrl, KOMGA_API_KEY: 'mauvaise-cle' } }));
  for (const x of [good, bad]) await x.post('/subscribe', { subscription: { endpoint: 'https://push.example.test/k', keys: fakeSubscription('x').keys }, favorites: ['k:S001'], lang: 'en' }, { cookie });
  await Promise.all([good.settle(), bad.settle()]);
  await afterPoll(good, () => m.addBook('S001'));
  await bad.polled(1);
  assert.deepEqual(good.pushes().map((p) => p.payload.tag), ['series-k:S001']);
  assert.deepEqual(bad.pushes(), []);
  assert.ok(bad.log.some((l) => l.includes('Vérification de komga impossible') && l.includes('401')), bad.log.join('|'));
  assert.equal(bad.child.exitCode, null);
  assert.equal((await bad.call('GET', '/health')).status, 200);
  await good.stop(); await bad.stop(); await m.stop();
});

try { await run(); } finally { await n?.stop(); for (const s of stoppers) await s.stop?.().catch(() => {}); }
