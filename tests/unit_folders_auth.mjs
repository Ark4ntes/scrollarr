// Authentification, session, limitation des tentatives, garde-fous inter-origines.
// Lancer avec : node tests/unit_folders_auth.mjs
import assert from 'node:assert/strict';
import { suite, fixture, env, passwordEnv, boot, get, post, request, CREDENTIALS, JSON_POST } from './_folders.mjs';

const { test, run } = suite('folders auth');
const cookieOf = (res) => (res.headers['set-cookie'] || [])[0]?.split(';')[0] || '';
const PROTECTED = ['/api/v1/libraries', '/api/v1/series', '/api/v1/series/0123456789abcdef', '/api/v1/series/0123456789abcdef/books',
  '/api/v1/books/0123456789abcdef.0123456789abcdef', '/api/v1/books/0123456789abcdef.0123456789abcdef/next', '/api/v1/scan', '/nimporte/quoi'];

async function withPassword(fn, overrides = {}) {
  const fx = fixture();
  const app = await boot(passwordEnv(fx), overrides);
  try { await fn(app, fx); } finally { await app.close(); }
}
const login = async (app, extra = {}) => post(app, '/api/v1/login', CREDENTIALS, extra);

test('password mode: everything except /health is refused without a session', () => withPassword(async (app) => {
  for (const path of PROTECTED) assert.equal((await get(app, path)).status, 401, path);
  assert.equal((await post(app, '/api/v1/scan')).status, 401);
  assert.equal((await get(app, '/api/v1/session')).status, 401);
  const health = await get(app, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.auth, 'password');
  assert.equal(health.json.ok, true);
}));
test('login: wrong credentials are refused, right ones open a session with a hardened cookie', () => withPassword(async (app) => {
  assert.equal((await post(app, '/api/v1/login', { username: 'lecteur', password: 'faux' })).status, 401);
  assert.equal((await post(app, '/api/v1/login', { username: 'autre', password: CREDENTIALS.password })).status, 401);
  assert.equal((await post(app, '/api/v1/login', { username: 1, password: 2 })).status, 401);
  assert.equal((await post(app, '/api/v1/login', {})).status, 401);
  const ok = await login(app);
  assert.equal(ok.status, 200);
  const header = ok.headers['set-cookie'][0];
  assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/); assert.match(header, /Path=\//);
  assert.doesNotMatch(header, /Secure/); // pas de HTTPS vu par le service
  const cookie = cookieOf(ok);
  for (const path of PROTECTED.slice(0, 2).concat('/api/v1/scan')) assert.equal((await get(app, path, { Cookie: cookie })).status, 200, path);
  assert.deepEqual((await get(app, '/api/v1/session', { Cookie: cookie })).json, { authenticated: true, user: 'lecteur', auth: 'password' });
}));
test('the cookie is Secure when the proxy says the request came in over HTTPS', () => withPassword(async (app) => {
  const res = await login(app, { 'X-Forwarded-Proto': 'https' });
  assert.match(res.headers['set-cookie'][0], /; Secure/);
}));
test('a forged, truncated or foreign cookie is refused', () => withPassword(async (app) => {
  const real = cookieOf(await login(app));
  const [payload, sig] = real.split('=')[1].split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'lecteur', e: Date.now() + 1e9 })).toString('base64url');
  for (const bad of [`folders_session=${forged}.${sig}`, `folders_session=${payload}.${sig.slice(1)}x`, `folders_session=${payload}`, 'folders_session=.', 'folders_session=garbage', 'autre=1']) {
    assert.equal((await get(app, '/api/v1/libraries', { Cookie: bad })).status, 401, bad);
  }
}));
test('a session expires', () => withPassword(async (app) => {
  const cookie = cookieOf(await login(app));
  assert.equal((await get(app, '/api/v1/libraries', { Cookie: cookie })).status, 200);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await get(app, '/api/v1/libraries', { Cookie: cookie })).status, 401);
}, { sessionHours: 0.0001 }));
test('logout clears the cookie', () => withPassword(async (app) => {
  const out = await post(app, '/api/v1/logout', {}, { Cookie: cookieOf(await login(app)) });
  assert.equal(out.status, 204);
  assert.match(out.headers['set-cookie'][0], /Max-Age=0/);
}));
test('attempts are limited per address: blocked even with the right password, other addresses unaffected', () => withPassword(async (app) => {
  const bad = (ip) => post(app, '/api/v1/login', { username: 'lecteur', password: 'faux' }, { 'X-Forwarded-For': ip });
  for (let i = 0; i < 3; i++) assert.equal((await bad('10.0.0.1')).status, 401);
  const blocked = await bad('10.0.0.1');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await post(app, '/api/v1/login', CREDENTIALS, { 'X-Forwarded-For': '10.0.0.1' })).status, 429);
  assert.equal((await post(app, '/api/v1/login', CREDENTIALS, { 'X-Forwarded-For': '10.0.0.2' })).status, 200);
}, { loginAttempts: 3, trustProxy: true }));
test('without a trusted proxy, X-Forwarded-For cannot be used to dodge the limit', () => withPassword(async (app) => {
  for (let i = 0; i < 3; i++) await post(app, '/api/v1/login', { username: 'lecteur', password: 'faux' }, { 'X-Forwarded-For': `10.0.0.${i}` });
  assert.equal((await post(app, '/api/v1/login', CREDENTIALS, { 'X-Forwarded-For': '10.9.9.9' })).status, 429);
}, { loginAttempts: 3, trustProxy: false }));
test('a successful login resets the failure count', () => withPassword(async (app) => {
  for (let round = 0; round < 3; round++) {
    await post(app, '/api/v1/login', { username: 'lecteur', password: 'faux' });
    assert.equal((await login(app)).status, 200);
  }
}, { loginAttempts: 2 }));
test('changing the credentials closes existing sessions', async () => {
  const fx = fixture();
  const first = await boot(passwordEnv(fx));
  const cookie = cookieOf(await login(first));
  await first.close();
  const second = await boot(passwordEnv(fx)); // mêmes identifiants, même clé : la session survit au redémarrage
  assert.equal((await get(second, '/api/v1/libraries', { Cookie: cookie })).status, 200);
  await second.close();
  const third = await boot(passwordEnv(fx, { FOLDERS_PASSWORD: 'un-autre-mot-de-passe' }));
  try { assert.equal((await get(third, '/api/v1/libraries', { Cookie: cookie })).status, 401); } finally { await third.close(); }
});

test('none mode: open access, login refused, logout harmless, /health says so', async () => {
  const app = await boot(env({}, fixture()));
  try {
    assert.equal((await get(app, '/api/v1/libraries')).status, 200);
    assert.equal((await get(app, '/health')).json.auth, 'none');
    assert.deepEqual((await get(app, '/api/v1/session')).json, { authenticated: true, user: null, auth: 'none' });
    assert.equal((await post(app, '/api/v1/login', CREDENTIALS)).status, 400);
    const out = await post(app, '/api/v1/logout');
    assert.equal(out.status, 204);
    assert.equal(out.headers['set-cookie'], undefined);
  } finally { await app.close(); }
});

// ── Garde-fous inter-origines (valent dans les deux modes) ──
async function withNone(fn) {
  const app = await boot(env({}, fixture()));
  try { await fn(app); } finally { await app.close(); }
}
const host = (app) => `127.0.0.1:${app.port}`;

test('non-GET requests need X-Requested-With and a JSON content type', () => withNone(async (app) => {
  const body = '{}';
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { 'X-Requested-With': 'x' }, body })).status, 415);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { 'X-Requested-With': 'x', 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { 'X-Requested-With': 'x', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b' })).status, 415);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { ...JSON_POST, 'Content-Type': 'application/json; charset=utf-8' }, body })).status, 202);
}));
test('login is guarded too, in password mode', () => withPassword(async (app) => {
  const body = JSON.stringify(CREDENTIALS);
  assert.equal((await request(app, 'POST', '/api/v1/login', { headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await request(app, 'POST', '/api/v1/login', { headers: { 'X-Requested-With': 'x', 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await request(app, 'POST', '/api/v1/login', { headers: { ...JSON_POST, Origin: 'https://autre.exemple' }, body })).status, 403);
}));
test('an Origin that does not match the host is refused, on any method; a matching one passes', () => withNone(async (app) => {
  for (const origin of ['https://autre.exemple', 'null', 'pas une url', `http://127.0.0.1:${app.port + 1}`]) {
    assert.equal((await get(app, '/api/v1/libraries', { Origin: origin })).status, 403, origin);
    assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: { ...JSON_POST, Origin: origin }, body: '{}' })).status, 403, origin);
  }
  assert.equal((await get(app, '/api/v1/libraries', { Origin: `http://${host(app)}` })).status, 200);
  assert.equal((await get(app, '/api/v1/libraries', { Origin: `https://${host(app)}` })).status, 200);
}));
test('no CORS: OPTIONS and other methods are refused and no Access-Control header is ever sent', () => withNone(async (app) => {
  for (const method of ['OPTIONS', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const res = await request(app, method, '/api/v1/libraries', { headers: { Origin: `http://${host(app)}`, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(res.status, 405, method);
    assert.ok(!Object.keys(res.headers).some((h) => h.startsWith('access-control-')), method);
  }
  const ok = await get(app, '/api/v1/libraries', { Origin: `http://${host(app)}` });
  assert.ok(!Object.keys(ok.headers).some((h) => h.startsWith('access-control-')));
}));
test('body limit: more than 64 KB is refused; invalid JSON is a 400', () => withNone(async (app) => {
  const big = JSON.stringify({ x: 'a'.repeat(70000) });
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: JSON_POST, body: big })).status, 413);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: JSON_POST, body: '{pas du json' })).status, 400);
  assert.equal((await request(app, 'POST', '/api/v1/scan', { headers: JSON_POST, body: '[1]' })).status, 400);
}));
test('every response carries the hardening headers', () => withNone(async (app) => {
  for (const path of ['/health', '/api/v1/libraries', '/api/v1/series/zzz', '/nimporte/quoi']) {
    const res = await get(app, path);
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox", path);
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
    assert.match(res.headers['content-type'], /^application\/json/, path);
  }
}));

run();
