// Intégration du notifier (robustesse) : ce qu'un appelant ou une configuration maladroite ne doit pas pouvoir provoquer.
// Chaque test ici a d'abord échoué sur le service tel qu'il était, puis a motivé une correction.
// Lancer avec : node tests/integration_notifier_robustness.mjs   (après « npm ci » dans notifier/ ; nécessite openssl)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { suite, startMock, startNotifier, startPushService, fakeSubscription, komgaCookie, sleep } from './_notifier.mjs';

const { test, run } = suite('notifier robustness');
const stoppers = [];
const own = (x) => { stoppers.push(x); return x; };

const mock = own(await startMock({ auth: 'none', servers: 'suwayomi,komga' }));
const cookie = await komgaCookie(mock);
const fresh = () => startNotifier({ env: { SUWAYOMI_URL: mock.suwayomiUrl } }).then(own);

test('a malformed request target does not stop the service (it answers 400 and keeps serving)', async () => {
  const n = await fresh();
  for (const target of ['//[', 'http://[::1', '//%', '//[a']) {
    const answer = await new Promise((resolve) => {
      let text = '';
      const s = net.connect(n.port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      s.on('data', (c) => { text += c; });
      s.on('error', () => resolve(text)); s.on('close', () => resolve(text));
      setTimeout(() => { s.destroy(); resolve(text); }, 1500);
    });
    await sleep(50);
    assert.equal(n.child.exitCode, null, `le service s'est arrêté sur ${JSON.stringify(target)} : ${n.log.slice(-3).join('|')}`);
    assert.match(answer, /^HTTP\/1\.1 (400|404)/, `${JSON.stringify(target)} : ${answer.slice(0, 60)}`);
    assert.equal((await n.call('GET', '/health')).status, 200);
  }
});

test('a body over the size limit is not stored, whatever the way it arrives', async () => {
  const n = await fresh();
  const before = (await n.call('GET', '/health')).json.subscriptions;
  const sub = fakeSubscription('https://push.example.test/huge');
  const huge = JSON.stringify({ subscription: sub, favorites: ['x'.repeat(100001)] });
  const outcome = await n.call('POST', '/subscribe', { cookie, body: huge }).then((r) => r.status, (e) => e.code || e.message);
  assert.ok(outcome === 'ECONNRESET' || outcome === 'socket hang up' || outcome >= 400, 'refusé : ' + outcome);
  // Plusieurs fragments, le dernier franchissant la limite.
  const parts = await new Promise((resolve) => {
    const s = net.connect(n.port, '127.0.0.1', async () => {
      const body = JSON.stringify({ subscription: fakeSubscription('https://push.example.test/huge2'), favorites: ['y'.repeat(120000)] });
      s.write(`POST /subscribe HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n`);
      for (let i = 0; i < body.length; i += 20000) { s.write(body.slice(i, i + 20000)); await sleep(5); }
    });
    s.on('error', () => resolve('')); s.on('close', () => resolve('')); s.on('data', () => {});
    setTimeout(() => { s.destroy(); resolve(''); }, 2000);
  });
  assert.equal(parts, '');
  await sleep(200);
  assert.equal((await n.call('GET', '/health')).json.subscriptions, before, 'aucun abonnement n\'est né d\'un corps trop gros');
  assert.equal(n.child.exitCode, null);
});

test('an unusable POLL_MINUTES (not a number, or too large for a timer) never makes the service poll in a tight loop', async () => {
  for (const [value, shown] of [['abc', '10'], ['10min', '10'], ['NaN', '10'], ['Infinity', '10'], ['1e12', '1440']]) { // trop grand : plafonné à un jour
    const m = own(await startMock({ auth: 'none', servers: 'suwayomi' }));
    const x = own(await startNotifier({ env: { SUWAYOMI_URL: m.suwayomiUrl, POLL_MINUTES: value } }));
    await sleep(2500);
    const polls = (await m.requests()).filter((op) => op === 'Latest').length;
    assert.ok(polls >= 1 && polls <= 2, `POLL_MINUTES=${value} : ${polls} vérifications en 2,5 s`);
    assert.ok(x.log.some((l) => l.includes(`toutes les ${shown} min`)), x.log.join('|'));
    await x.stop(); await m.stop();
  }
});

test('the test route says so when the push service refuses the message', async () => {
  const push = own(await startPushService());
  const x = own(await startNotifier({ env: { SUWAYOMI_URL: mock.suwayomiUrl, PUSH_DRY_RUN: '0', NODE_EXTRA_CA_CERTS: push.certFile } }));
  const device = async (status) => {
    const sub = fakeSubscription(push.endpoint(status));
    assert.equal((await x.post('/subscribe', { subscription: sub, favorites: [] }, { cookie })).status, 200);
    return sub;
  };
  const ok = await device(201);
  assert.deepEqual((await x.post('/test', { endpoint: ok.endpoint }, { cookie })).json, { ok: true });
  for (const status of [410, 404, 500, 429]) {
    const sub = await device(status);
    const res = await x.post('/test', { endpoint: sub.endpoint }, { cookie });
    assert.equal(res.status, 502, `le service de push répond ${status} : ${res.text}`);
    assert.deepEqual(res.json, { error: 'push failed' });
  }
  await x.stop();
});

try { await run(); } finally { for (const s of stoppers) await s.stop?.().catch(() => {}); }
