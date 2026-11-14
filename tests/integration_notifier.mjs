// Intégration du notifier (partie « service ») : démarrage, clés VAPID, qui peut s'abonner
// (chaque façon d'authentifier un appelant, chaque mode de Suwayomi, Komga), abonnement,
// liste des séries suivies, désabonnement, persistance, corps invalides, routes inconnues.
// Le vrai service tourne en processus séparé (PUSH_DRY_RUN=1) à côté des faux serveurs.
// Lancer avec : node tests/integration_notifier.mjs   (après « npm ci » dans notifier/)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  suite, startMock, startNotifier, tmp, freePort, fakeSubscription,
  komgaCookie, suwayomiBasicCookie, suwayomiTokenCookie, expiredTokenCookie,
} from './_notifier.mjs';

const { test, run } = suite('notifier service');
const endpoint = () => 'https://push.example.test/' + randomUUID();
const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const stoppers = [];
const own = (x) => { stoppers.push(x); return x; };

/** Mock + notifier configurés pour un mode donné. */
async function fixture({ auth = 'none', servers = 'suwayomi', env = {} } = {}) {
  const mock = own(await startMock({ auth, servers: servers === 'both' ? 'suwayomi,komga' : servers }));
  const e = {};
  if (servers !== 'komga') Object.assign(e, { SUWAYOMI_URL: mock.suwayomiUrl, SUWAYOMI_USER: 'demo', SUWAYOMI_PASSWORD: 'demo' });
  if (servers !== 'suwayomi') Object.assign(e, { KOMGA_URL: mock.komgaUrl, KOMGA_API_KEY: 'demo-key' });
  const notifier = own(await startNotifier({ env: { ...e, ...env } }));
  return { mock, notifier };
}

// ───────────── Démarrage ─────────────
test('startup: refuses to start without a server to watch (exit code 1, message names the variables)', async () => {
  for (const env of [{}, { SUWAYOMI_URL: '' }, { KOMGA_URL: 'http://127.0.0.1:1' }, { KOMGA_API_KEY: 'k' }, { KOMGA_URL: '', KOMGA_API_KEY: 'k' }]) {
    const n = await startNotifier({ env, expectExit: true });
    const { code } = await n.exited;
    assert.equal(code, 1, JSON.stringify(env));
    assert.ok(n.log.some((l) => l.includes('Renseignez SUWAYOMI_URL') && l.includes('KOMGA_API_KEY')), n.log.join('|'));
    assert.ok(!n.log.some((l) => l.includes('à l\'écoute')), 'ne doit pas écouter');
  }
});
test('startup: Komga alone needs both its URL and its API key; Suwayomi alone is enough', async () => {
  const k = own(await startNotifier({ env: { KOMGA_URL: 'http://127.0.0.1:1', KOMGA_API_KEY: 'k' } }));
  assert.ok(k.log.includes('Serveurs surveillés : komga.'), k.log.join('|'));
  const s = own(await startNotifier({ env: { SUWAYOMI_URL: 'http://127.0.0.1:1' } }));
  assert.ok(s.log.includes('Serveurs surveillés : suwayomi.'), s.log.join('|'));
  const both = own(await startNotifier({ env: { SUWAYOMI_URL: 'http://127.0.0.1:1', KOMGA_URL: 'http://127.0.0.1:1', KOMGA_API_KEY: 'k' } }));
  assert.ok(both.log.includes('Serveurs surveillés : suwayomi, komga.'), both.log.join('|'));
  for (const x of [k, s, both]) await x.stop();
});
test('startup: trailing slashes of the server addresses are accepted', async () => {
  const mock = own(await startMock());
  const n = own(await startNotifier({ env: { SUWAYOMI_URL: mock.suwayomiUrl + '/' } }));
  await n.polled(1);
  assert.ok(!n.log.some((l) => l.includes('impossible')), n.log.join('|'));
  assert.ok(readJson(n.dataDir, 'seen.json').baseline.suwayomi, 'la première vérification a réussi');
  await n.stop(); await mock.stop();
});

test('VAPID: keys are created on first start, then reused after a restart; /health and /vapid answer without any session', async () => {
  const dir = tmp();
  const dataDir = join(dir, 'a', 'b'); // dossier de données absent : créé
  const first = await startNotifier({ dataDir, env: { SUWAYOMI_URL: 'http://127.0.0.1:1' } });
  assert.ok(first.log.includes('Clés VAPID générées.'));
  const key1 = (await first.call('GET', '/vapid')).json.publicKey;
  assert.match(key1, /^[A-Za-z0-9_-]{87}$/); // point P-256 non compressé, 65 octets en base64url
  assert.equal(key1, readJson(dataDir, 'vapid.json').publicKey);
  assert.ok(readJson(dataDir, 'vapid.json').privateKey.length > 40);
  const health = await first.call('GET', '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { ok: true, subscriptions: 0 });
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.match(health.headers['content-type'], /^application\/json/);
  await first.stop();
  const second = own(await startNotifier({ dataDir, env: { SUWAYOMI_URL: 'http://127.0.0.1:1' } }));
  assert.ok(!second.log.includes('Clés VAPID générées.'), 'les clés existantes ne sont pas régénérées');
  assert.equal((await second.call('GET', '/vapid')).json.publicKey, key1);
  await second.stop();
});
test('startup: unreadable subscription file does not prevent the start (starts empty)', async () => {
  const dataDir = tmp();
  writeFileSync(join(dataDir, 'subscriptions.json'), '{ pas du json');
  const n = own(await startNotifier({ dataDir, env: { SUWAYOMI_URL: 'http://127.0.0.1:1' } }));
  assert.deepEqual((await n.call('GET', '/health')).json, { ok: true, subscriptions: 0 });
  await n.stop();
});

// ───────────── Qui peut s'abonner ─────────────
/**
 * Pour un notifier donné : les appelants `bad` sont refusés sur chaque route qui exige une identité, avec un corps valide
 * comme avec un corps illisible (l'identité est vérifiée avant le corps) ; l'appelant `good` passe partout.
 */
async function authMatrix(label, { notifier: n }, good, bad) {
  const mine = fakeSubscription(endpoint());
  const created = await n.post('/subscribe', { subscription: mine, favorites: ['s:1'], lang: 'en' }, { cookie: good.cookie });
  assert.equal(created.status, 200, `${label}: abonnement de l'appelant valide : ${created.text}`);
  const before = (await n.call('GET', '/health')).json.subscriptions;
  for (const who of bad) {
    const other = fakeSubscription(endpoint());
    const bodies = {
      '/subscribe': { subscription: other, favorites: [], lang: 'en' },
      '/unsubscribe': { endpoint: mine.endpoint },
      '/test': { endpoint: mine.endpoint },
      '/nope': {},
    };
    for (const [path, body] of Object.entries(bodies)) {
      const res = await n.post(path, body, { cookie: who.cookie, headers: who.headers });
      assert.equal(res.status, 401, `${label} / ${who.name} / ${path} : ${res.text}`);
      assert.deepEqual(res.json, { error: 'unauthorized' });
      const raw = await n.post(path, '{ pas du json', { cookie: who.cookie, headers: who.headers });
      assert.equal(raw.status, 401, `${label} / ${who.name} / ${path} avec un corps illisible`);
    }
  }
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before, `${label}: un appelant refusé n'a rien créé ni supprimé`);
  assert.equal(n.pushes().length, 0, `${label}: un appelant refusé n'a rien déclenché`);
  // L'appelant valide passe sur chaque route (le corps est alors jugé).
  const mate = fakeSubscription(endpoint());
  assert.equal((await n.post('/subscribe', { subscription: mate, favorites: [], lang: 'en' }, { cookie: good.cookie, headers: good.headers })).status, 200);
  assert.equal((await n.post('/test', { endpoint: mate.endpoint }, { cookie: good.cookie, headers: good.headers })).status, 200);
  assert.equal(n.pushes().length, 1);
  assert.equal((await n.post('/nope', {}, { cookie: good.cookie, headers: good.headers })).status, 404);
  assert.equal((await n.post('/unsubscribe', { endpoint: mate.endpoint }, { cookie: good.cookie, headers: good.headers })).status, 200);
  assert.equal((await n.post('/unsubscribe', { endpoint: mine.endpoint }, { cookie: good.cookie, headers: good.headers })).status, 200);
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before - 1);
  for (const path of ['/health', '/vapid']) assert.equal((await n.call('GET', path, { cookie: 'x=y' })).status, 200, 'les routes publiques ne demandent rien');
}
const noSession = { name: 'no cookie' };
const callerHeaders = { name: 'Authorization and X-API-Key sent by the caller are not credentials', headers: { Authorization: 'Basic ' + Buffer.from('demo:demo').toString('base64'), 'X-API-Key': 'demo-key' } };

test('Suwayomi without authentication: every caller is accepted (one shared identity)', async () => {
  const fx = await fixture({ auth: 'none' });
  const n = fx.notifier;
  assert.equal((await n.post('/subscribe', { subscription: fakeSubscription(endpoint()) })).status, 200, 'sans cookie');
  assert.equal((await n.post('/subscribe', { subscription: fakeSubscription(endpoint()) }, { cookie: 'autre=1' })).status, 200, 'avec un cookie quelconque');
  await n.stop(); await fx.mock.stop();
});
for (const mode of ['basic', 'simple']) {
  test(`Suwayomi "${mode}" mode: the scrollarr_suwa_basic cookie is the only credential`, async () => {
    const fx = await fixture({ auth: mode });
    await authMatrix(mode, fx, { cookie: suwayomiBasicCookie() }, [
      noSession,
      { name: 'wrong password', cookie: suwayomiBasicCookie('demo', 'faux') },
      { name: 'wrong user', cookie: suwayomiBasicCookie('autre', 'demo') },
      { name: 'cookie that is not base64', cookie: 'scrollarr_suwa_basic=%25%25' },
      { name: 'unrelated cookie', cookie: 'KOMGA-SESSION=abc; suwayomi-server-token=h.e30.s' },
      callerHeaders,
    ]);
    await fx.notifier.stop(); await fx.mock.stop();
  });
}
test('Suwayomi "UI login" mode: only a valid access token cookie is accepted', async () => {
  const fx = await fixture({ auth: 'ui' });
  const token = await suwayomiTokenCookie(fx.mock);
  assert.ok(token, 'le faux Suwayomi délivre un jeton');
  await authMatrix('ui', fx, { cookie: token }, [
    noSession,
    { name: 'expired token', cookie: expiredTokenCookie() },
    { name: 'garbage token', cookie: 'suwayomi-server-token=n-importe-quoi' },
    { name: 'basic cookie in token mode', cookie: suwayomiBasicCookie() },
    { name: 'token sent as an Authorization header instead of a cookie', headers: { Authorization: 'Bearer ' + token.split('=')[1] } },
    callerHeaders,
  ]);
  await fx.notifier.stop(); await fx.mock.stop();
});
test('Komga: only a live Komga session cookie is accepted', async () => {
  const fx = await fixture({ auth: 'none', servers: 'komga' });
  const cookie = await komgaCookie(fx.mock);
  assert.ok(cookie?.startsWith('KOMGA-SESSION='));
  await authMatrix('komga', fx, { cookie }, [
    noSession,
    { name: 'unknown session', cookie: 'KOMGA-SESSION=inconnue' },
    { name: 'cookie of another application', cookie: 'session=1; suwayomi-server-token=x' },
    callerHeaders,
  ]);
  // Une session fermée n'est plus acceptée.
  const n = fx.notifier;
  const mine = fakeSubscription(endpoint());
  assert.equal((await n.post('/subscribe', { subscription: mine }, { cookie })).status, 200);
  await fetch(fx.mock.komgaUrl + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal((await n.post('/unsubscribe', { endpoint: mine.endpoint }, { cookie })).status, 401, 'session fermée');
  await n.stop(); await fx.mock.stop();
});
test('Suwayomi (basic) and Komga together: either session is accepted, anything else is refused', async () => {
  const fx = await fixture({ auth: 'basic', servers: 'both' });
  const n = fx.notifier;
  const k = await komgaCookie(fx.mock);
  for (const [name, cookie] of [['komga', k], ['suwayomi', suwayomiBasicCookie()], ['both', `${k}; ${suwayomiBasicCookie()}`]]) {
    assert.equal((await n.post('/subscribe', { subscription: fakeSubscription(endpoint()) }, { cookie })).status, 200, name);
  }
  for (const cookie of [undefined, 'KOMGA-SESSION=inconnue', suwayomiBasicCookie('demo', 'faux'), `KOMGA-SESSION=inconnue; ${suwayomiBasicCookie('x', 'y')}`]) {
    assert.equal((await n.post('/subscribe', { subscription: fakeSubscription(endpoint()) }, { cookie })).status, 401, String(cookie));
  }
  await n.stop(); await fx.mock.stop();
});
test('a watched server that is unreachable: callers are refused (401), public routes still answer', async () => {
  const dead = await freePort(); // personne n'écoute
  const n = own(await startNotifier({ env: { SUWAYOMI_URL: `http://127.0.0.1:${dead}`, KOMGA_URL: `http://127.0.0.1:${dead}`, KOMGA_API_KEY: 'k' } }));
  const res = await n.post('/subscribe', { subscription: fakeSubscription(endpoint()) }, { cookie: 'KOMGA-SESSION=abc; ' + suwayomiBasicCookie() });
  assert.equal(res.status, 401);
  assert.equal((await n.call('GET', '/health')).status, 200);
  assert.equal((await n.call('GET', '/vapid')).status, 200);
  await n.polled(1);
  assert.ok(n.log.some((l) => l.includes('Vérification de suwayomi impossible')) && n.log.some((l) => l.includes('Vérification de komga impossible')), n.log.join('|'));
  await n.stop();
});

// ───────────── Abonnement, séries suivies, désabonnement ─────────────
let api; // notifier Suwayomi (basic) + Komga ; deux appelants distincts
let alice; let bob;
test('subscribe: stores only the known fields, answers the number of followed series', async () => {
  const fx = await fixture({ auth: 'basic', servers: 'both' });
  api = fx;
  alice = { cookie: await komgaCookie(fx.mock) }; // komga:U1
  bob = { cookie: suwayomiBasicCookie() };         // suwayomi
  const n = api.notifier;
  const sub = { ...fakeSubscription(endpoint()), expirationTime: null, extra: 'à ignorer' };
  const res = await n.post('/subscribe', { subscription: sub, favorites: ['s:1', 'k:S001'], lang: 'fr', other: 1 }, alice);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, favorites: 2 });
  assert.equal((await n.call('GET', '/health')).json.subscriptions, 1);
  const stored = readJson(n.dataDir, 'subscriptions.json');
  assert.deepEqual(Object.keys(stored), [sub.endpoint]);
  assert.deepEqual(stored[sub.endpoint], {
    subscription: { endpoint: sub.endpoint, keys: sub.keys }, userId: 'komga:U1', favorites: ['s:1', 'k:S001'], lang: 'fr',
  });
  alice.sub = sub;
});
test('subscribe: a second call from the same device replaces the list of followed series (still one subscription)', async () => {
  const n = api.notifier;
  const res = await n.post('/subscribe', { subscription: alice.sub, favorites: ['s:3'], lang: 'en' }, alice);
  assert.deepEqual(res.json, { ok: true, favorites: 1 });
  assert.equal((await n.call('GET', '/health')).json.subscriptions, 1);
  const stored = readJson(n.dataDir, 'subscriptions.json')[alice.sub.endpoint];
  assert.deepEqual([stored.favorites, stored.lang], [['s:3'], 'en']);
  const empty = await n.post('/subscribe', { subscription: alice.sub, favorites: [] }, alice);
  assert.deepEqual(empty.json, { ok: true, favorites: 0 });
  assert.deepEqual(readJson(n.dataDir, 'subscriptions.json')[alice.sub.endpoint].favorites, []);
});
test('subscribe: favorites that are not a list of strings are cleaned, the list is capped at 2000, lang falls back to en', async () => {
  const n = api.notifier;
  const put = async (body) => (await n.post('/subscribe', { subscription: alice.sub, ...body }, alice)).json;
  const stored = () => readJson(n.dataDir, 'subscriptions.json')[alice.sub.endpoint];
  assert.deepEqual(await put({ favorites: ['s:1', 2, null, { a: 1 }, ['x'], 's:2'] }), { ok: true, favorites: 2 });
  assert.deepEqual(stored().favorites, ['s:1', 's:2']);
  for (const favorites of ['s:1', 7, { 0: 's:1' }, null, undefined]) assert.deepEqual(await put({ favorites }), { ok: true, favorites: 0 }, JSON.stringify(favorites));
  const many = Array.from({ length: 2500 }, (_, i) => 's:' + i);
  assert.deepEqual(await put({ favorites: many }), { ok: true, favorites: 2000 });
  assert.equal(stored().favorites[1999], 's:1999');
  for (const [lang, expected] of [['fr', 'fr'], ['en', 'en'], ['de', 'en'], ['FR', 'en'], [5, 'en'], [undefined, 'en']]) {
    await put({ favorites: [], lang });
    assert.equal(stored().lang, expected, String(lang));
  }
});
test('subscribe: an invalid subscription is refused with 400 and nothing is stored', async () => {
  const n = api.notifier;
  const good = fakeSubscription(endpoint());
  const before = (await n.call('GET', '/health')).json.subscriptions;
  const bad = {
    'endpoint over plain http': { ...good, endpoint: 'http://push.example.test/x' },
    'endpoint is not a URL': { ...good, endpoint: 'pas une adresse' },
    'endpoint javascript:': { ...good, endpoint: 'javascript:alert(1)' },
    'endpoint file:': { ...good, endpoint: 'file:///etc/passwd' },
    'endpoint is a number': { ...good, endpoint: 5 },
    'endpoint missing': { keys: good.keys },
    'endpoint https uppercase scheme is still https, but a leading space is not': { ...good, endpoint: ' https://push.example.test/x' },
    'keys missing': { endpoint: good.endpoint },
    'p256dh missing': { endpoint: good.endpoint, keys: { auth: good.keys.auth } },
    'auth missing': { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh } },
    'p256dh empty': { endpoint: good.endpoint, keys: { p256dh: '', auth: good.keys.auth } },
    'subscription is a string': 'https://push.example.test/x',
    'subscription is null': null,
    'subscription is an array': [],
  };
  for (const [name, subscription] of Object.entries(bad)) {
    const res = await n.post('/subscribe', { subscription, favorites: ['s:1'] }, alice);
    assert.equal(res.status, 400, `${name} : ${res.text}`);
    assert.deepEqual(res.json, { error: 'invalid subscription' }, name);
  }
  const noSub = await n.post('/subscribe', { favorites: ['s:1'] }, alice);
  assert.deepEqual([noSub.status, noSub.json], [400, { error: 'invalid subscription' }]);
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before);
});
test('malformed bodies: 400 "bad request" on every route, whatever the content type', async () => {
  const n = api.notifier;
  for (const path of ['/subscribe', '/unsubscribe', '/test']) {
    for (const body of ['', '{', '{"a":', 'null', '0', 'false', 'undefined', '<xml/>', '\u0000']) {
      const res = await n.call('POST', path, { cookie: alice.cookie, body });
      assert.deepEqual([res.status, res.json?.error], [400, 'bad request'], `${path} ${JSON.stringify(body)}`);
    }
    const noBody = await n.call('POST', path, { cookie: alice.cookie });
    assert.equal(noBody.status, 400, path + ' sans corps');
    const form = await n.call('POST', path, { cookie: alice.cookie, body: 'endpoint=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 400, path + ' formulaire');
  }
  // Un JSON valide mais d'une autre forme : jamais une erreur serveur.
  for (const body of ['[]', '[1,2]', '{}', '"texte"', '7', '{"endpoint":5}', '{"endpoint":{"a":1}}', '{"endpoint":null}']) {
    for (const path of ['/unsubscribe', '/test']) {
      const res = await n.call('POST', path, { cookie: alice.cookie, body });
      assert.equal(res.status, 404, `${path} ${body} : ${res.text}`);
    }
    const res = await n.call('POST', '/subscribe', { cookie: alice.cookie, body });
    assert.deepEqual([res.status, res.json?.error], [400, 'invalid subscription'], `/subscribe ${body}`);
  }
  assert.equal((await n.call('GET', '/health')).status, 200);
});
test('a body just under the size limit is accepted (2000 followed series)', async () => {
  const n = api.notifier;
  const before = (await n.call('GET', '/health')).json.subscriptions;
  const big = await n.call('POST', '/subscribe', { cookie: alice.cookie, body: { subscription: fakeSubscription(endpoint()), favorites: Array.from({ length: 2000 }, (_, i) => `s:${i}-`.padEnd(40, 'x')) } });
  assert.deepEqual([big.status, big.json.favorites], [200, 2000]);
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before + 1);
});
test('unsubscribe and test: only the owner of a subscription can use it; unknown endpoints are 404', async () => {
  const n = api.notifier;
  await n.post('/subscribe', { subscription: alice.sub, favorites: ['s:1'], lang: 'en' }, alice);
  const before = (await n.call('GET', '/health')).json.subscriptions;
  for (const path of ['/unsubscribe', '/test']) {
    const foreign = await n.post(path, { endpoint: alice.sub.endpoint }, bob);
    assert.deepEqual([foreign.status, foreign.json], [404, { error: 'unknown subscription' }], path + ' par un autre utilisateur');
    const unknown = await n.post(path, { endpoint: endpoint() }, alice);
    assert.deepEqual([unknown.status, unknown.json], [404, { error: 'unknown subscription' }], path + ' inconnu');
  }
  assert.equal(n.pushes().length, 0, 'ni test ni envoi pour un autre utilisateur');
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before);
});
test('test route: sends one notification with the shape the service worker expects, in the language of the subscription', async () => {
  const n = api.notifier;
  const mine = fakeSubscription(endpoint());
  await n.post('/subscribe', { subscription: mine, favorites: [], lang: 'fr' }, alice);
  const from = n.pushes().length;
  const res = await n.post('/test', { endpoint: mine.endpoint }, alice);
  assert.deepEqual([res.status, res.json], [200, { ok: true }]);
  await n.post('/subscribe', { subscription: mine, favorites: [], lang: 'en' }, alice);
  await n.post('/test', { endpoint: mine.endpoint }, alice);
  const got = n.pushes().slice(from);
  assert.deepEqual(got, [
    { userId: 'komga:U1', payload: { title: 'Scrollarr', body: 'Les notifications fonctionnent.', tag: 'test', path: '/my/subscriptions' } },
    { userId: 'komga:U1', payload: { title: 'Scrollarr', body: 'Notifications are working.', tag: 'test', path: '/my/subscriptions' } },
  ]);
  await n.post('/unsubscribe', { endpoint: mine.endpoint }, alice);
});
test('unsubscribe: removes the subscription, persisted; a second call is 404', async () => {
  const n = api.notifier;
  const res = await n.post('/unsubscribe', { endpoint: alice.sub.endpoint }, alice);
  assert.deepEqual([res.status, res.json], [200, { ok: true }]);
  assert.ok(!(alice.sub.endpoint in readJson(n.dataDir, 'subscriptions.json')));
  assert.equal((await n.post('/unsubscribe', { endpoint: alice.sub.endpoint }, alice)).status, 404);
  assert.equal((await n.post('/test', { endpoint: alice.sub.endpoint }, alice)).status, 404, 'plus de test après désabonnement');
});
test('two users: each one sees and removes only their own subscription, even for the same series', async () => {
  const n = api.notifier;
  const a = fakeSubscription(endpoint());
  const b = fakeSubscription(endpoint());
  await n.post('/subscribe', { subscription: a, favorites: ['s:1'] }, alice);
  await n.post('/subscribe', { subscription: b, favorites: ['s:1'] }, bob);
  const stored = readJson(n.dataDir, 'subscriptions.json');
  assert.deepEqual([stored[a.endpoint].userId, stored[b.endpoint].userId], ['komga:U1', 'suwayomi']);
  assert.equal((await n.post('/unsubscribe', { endpoint: a.endpoint }, bob)).status, 404);
  assert.equal((await n.post('/unsubscribe', { endpoint: b.endpoint }, alice)).status, 404);
  assert.equal((await n.post('/unsubscribe', { endpoint: a.endpoint }, alice)).status, 200);
  assert.equal((await n.post('/unsubscribe', { endpoint: b.endpoint }, bob)).status, 200);
});
test('subscriptions survive a restart: same data folder, same owner, still removable', async () => {
  const n = api.notifier;
  const keep = fakeSubscription(endpoint());
  await n.post('/subscribe', { subscription: keep, favorites: ['s:1', 'k:S001'], lang: 'fr' }, alice);
  await n.post('/subscribe', { subscription: fakeSubscription(endpoint()), favorites: [], lang: 'en' }, bob);
  const key = (await n.call('GET', '/vapid')).json.publicKey;
  const count = (await n.call('GET', '/health')).json.subscriptions;
  assert.ok(count >= 2);
  await n.stop();
  const env = { SUWAYOMI_URL: api.mock.suwayomiUrl, SUWAYOMI_USER: 'demo', SUWAYOMI_PASSWORD: 'demo', KOMGA_URL: api.mock.komgaUrl, KOMGA_API_KEY: 'demo-key' };
  api.notifier = own(await startNotifier({ dataDir: n.dataDir, env }));
  const again = api.notifier;
  assert.equal((await again.call('GET', '/health')).json.subscriptions, count);
  assert.equal((await again.call('GET', '/vapid')).json.publicKey, key);
  assert.equal((await again.post('/unsubscribe', { endpoint: keep.endpoint }, bob)).status, 404, 'le propriétaire est conservé');
  assert.equal((await again.post('/test', { endpoint: keep.endpoint }, alice)).status, 200);
  assert.equal(again.pushes()[0].payload.body, 'Les notifications fonctionnent.', 'la langue est conservée');
  assert.equal((await again.post('/unsubscribe', { endpoint: keep.endpoint }, alice)).status, 200);
});

// ───────────── Routes et méthodes inconnues ─────────────
test('unknown routes and methods: 404 JSON, even with a valid session; nothing changes', async () => {
  const n = api.notifier;
  const before = (await n.call('GET', '/health')).json.subscriptions;
  for (const [method, path] of [
    ['GET', '/'], ['GET', '/nope'], ['GET', '/subscribe'], ['GET', '/unsubscribe'], ['GET', '/test'], ['GET', '/health/'], ['GET', '/vapid.json'],
    ['PUT', '/subscribe'], ['DELETE', '/subscribe'], ['PATCH', '/unsubscribe'], ['OPTIONS', '/subscribe'], ['PUT', '/health'], ['DELETE', '/vapid'],
  ]) {
    const res = await n.call(method, path, { cookie: alice.cookie, body: method === 'GET' ? undefined : { subscription: fakeSubscription(endpoint()) } });
    assert.deepEqual([res.status, res.json?.error], [404, 'not found'], `${method} ${path}`);
  }
  for (const path of ['/', '/nope', '/health', '/vapid', '/subscribe/x']) {
    const res = await n.post(path, {}, alice);
    assert.equal(res.status, 404, 'POST ' + path); // identité connue, mais ni route ni abonnement
  }
  assert.equal((await n.call('GET', '/health?verbose=1')).status, 200, 'la requête d\'adresse est ignorée');
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before);
});
try { await run(); } finally { for (const s of stoppers) await s.stop?.().catch(() => {}); }
