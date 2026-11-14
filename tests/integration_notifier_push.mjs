// Intégration du notifier (partie « envoi réel ») : sans PUSH_DRY_RUN, le service chiffre et envoie vraiment le message,
// ici vers un faux service de push HTTPS local (certificat auto-signé déclaré par NODE_EXTRA_CA_CERTS) : aucun vrai
// service de push (FCM, Mozilla, Apple) n'est contacté. On vérifie ce qui part, ce que l'appareil pourrait en déchiffrer,
// et le sort d'un abonnement que le service de push déclare expiré (404, 410) ou qui échoue autrement.
// Lancer avec : node tests/integration_notifier_push.mjs   (après « npm ci » dans notifier/ ; nécessite openssl)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, startMock, startNotifier, startPushService, decryptPush, fakeSubscription, komgaCookie } from './_notifier.mjs';

const { test, run } = suite('notifier real sending');
const stoppers = [];
const own = (x) => { stoppers.push(x); return x; };
const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

const push = own(await startPushService());
const mock = own(await startMock({ auth: 'none', servers: 'suwayomi,komga' }));
const cookie = await komgaCookie(mock);
const n = own(await startNotifier({ env: {
  SUWAYOMI_URL: mock.suwayomiUrl, KOMGA_URL: mock.komgaUrl, KOMGA_API_KEY: 'demo-key',
  PUSH_DRY_RUN: '0', NODE_EXTRA_CA_CERTS: push.certFile, VAPID_SUBJECT: 'mailto:test@example.test',
} }));
const vapidKey = (await n.call('GET', '/vapid')).json.publicKey;
const device = async (status, favorites = [], lang = 'en') => {
  const sub = fakeSubscription(push.endpoint(status));
  const res = await n.post('/subscribe', { subscription: sub, favorites, lang }, { cookie });
  assert.equal(res.status, 200);
  return sub;
};
const stored = () => Object.keys(readJson(n.dataDir, 'subscriptions.json'));
const sent = (sub) => push.requests.filter((r) => r.path === new URL(sub.endpoint).pathname);

test('the test route really sends: one encrypted request, VAPID-signed with the service key, TTL one day, readable only by the device', async () => {
  const sub = await device(201, [], 'fr');
  assert.equal((await n.post('/test', { endpoint: sub.endpoint }, { cookie })).status, 200);
  const [req] = sent(sub);
  assert.ok(req, 'le faux service de push a reçu un envoi');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.ttl, '86400');
  assert.equal(req.headers['content-encoding'], 'aes128gcm');
  assert.match(req.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  assert.equal(req.headers.authorization.split('k=')[1], vapidKey, 'signé avec la clé publiée sur /vapid');
  const claims = JSON.parse(Buffer.from(req.headers.authorization.split('t=')[1].split('.')[1], 'base64url'));
  assert.equal(claims.aud, new URL(sub.endpoint).origin);
  assert.equal(claims.sub, 'mailto:test@example.test', 'VAPID_SUBJECT');
  assert.ok(!req.body.includes('Scrollarr') && !req.body.includes('notifications'), 'le corps n\'est pas en clair');
  assert.deepEqual(decryptPush(sub, req.body), { title: 'Scrollarr', body: 'Les notifications fonctionnent.', tag: 'test', path: '/my/subscriptions' });
});
test('a new chapter is really sent to each device of the followers, and only to them', async () => {
  const mine = await device(201, ['s:1'], 'en');
  const other = await device(201, ['s:2'], 'fr');
  await n.polled(1);
  await mock.addChapter(1);
  await n.polled(1);
  assert.deepEqual(decryptPush(mine, sent(mine)[0].body), { title: 'Les Veilleurs de Brume', body: 'New chapter: Chapitre 39', tag: 'series-s:1', path: '/series/s:1' });
  assert.equal(sent(mine).length, 1);
  assert.equal(sent(other).length, 0);
});
test('expired subscription (push service answers 404 or 410): removed from memory and from the file; the others are kept', async () => {
  const live = await device(201);
  const missing = await device(404);
  const gone = await device(410);
  const before = (await n.call('GET', '/health')).json.subscriptions;
  for (const sub of [missing, gone]) await n.post('/test', { endpoint: sub.endpoint }, { cookie }); // la réponse de la route n'est pas jugée ici
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before - 2);
  assert.ok(!stored().includes(missing.endpoint) && !stored().includes(gone.endpoint) && stored().includes(live.endpoint));
  assert.equal((await n.post('/test', { endpoint: gone.endpoint }, { cookie })).status, 404, 'plus connu du service');
  assert.equal(n.log.filter((l) => l.startsWith('Envoi échoué')).length, 0, 'un abonnement expiré n\'est pas une erreur à journaliser');
});
test('expired subscription found while announcing a chapter: removed, and the devices after it still receive the notification', async () => {
  const gone = await device(410, ['s:3']);
  const after = await device(201, ['s:3']);
  const before = (await n.call('GET', '/health')).json.subscriptions;
  await n.polled(1);
  await mock.addChapter(3);
  await n.polled(1);
  assert.equal(sent(gone).length, 1);
  assert.equal(sent(after).length, 1, 'le suivant a bien reçu');
  assert.deepEqual(decryptPush(after, sent(after)[0].body).tag, 'series-s:3');
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before - 1);
  assert.ok(!stored().includes(gone.endpoint));
  await n.polled(1);
  await mock.addChapter(3);
  await n.polled(1);
  assert.equal(sent(gone).length, 1, 'plus aucun envoi vers un abonnement supprimé');
  assert.equal(sent(after).length, 2);
});
test('other failures (500, 429, connection cut) keep the subscription and are logged', async () => {
  const subs = { 500: await device(500), 429: await device(429), cut: await device('cut') };
  const before = (await n.call('GET', '/health')).json.subscriptions;
  for (const sub of Object.values(subs)) await n.post('/test', { endpoint: sub.endpoint }, { cookie });
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before);
  for (const sub of Object.values(subs)) assert.ok(stored().includes(sub.endpoint));
  const warnings = n.log.filter((l) => l.startsWith('Envoi échoué'));
  assert.ok(warnings.some((l) => l.endsWith(' 500')) && warnings.some((l) => l.endsWith(' 429')), warnings.join('|'));
  assert.equal(warnings.length, 3, warnings.join('|'));
  assert.equal(n.child.exitCode, null);
});
test('the removal of an expired subscription survives a restart', async () => {
  const gone = await device(410);
  await n.post('/test', { endpoint: gone.endpoint }, { cookie });
  const count = (await n.call('GET', '/health')).json.subscriptions;
  await n.stop();
  const again = own(await startNotifier({ dataDir: n.dataDir, env: { SUWAYOMI_URL: mock.suwayomiUrl, PUSH_DRY_RUN: '0' } }));
  assert.equal((await again.call('GET', '/health')).json.subscriptions, count);
  assert.ok(!readJson(again.dataDir, 'subscriptions.json')[gone.endpoint]);
});

try { await run(); } finally { for (const s of stoppers) await s.stop?.().catch(() => {}); }
