// Configuration : chaque configuration invalide fait échouer le démarrage.
// Lancer avec : node tests/unit_folders_config.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, tmp, fixture, env, passwordEnv, quiet } from './_folders.mjs';
import { readConfig, ConfigError } from '../folders/config.js';
import { start } from '../folders/app.js';

const { test, run } = suite('folders config');
const good = { FOLDERS_AUTH: 'password', FOLDERS_USER: 'lecteur', FOLDERS_PASSWORD: 'douze-caracteres' };
const refuses = (environment, re) => assert.throws(() => readConfig(environment), (e) => e instanceof ConfigError && re.test(e.message) && !e.message.includes('\n'));

test('no authentication mode, empty or unknown value: refused (no implicit default)', () => {
  refuses({}, /FOLDERS_AUTH/);
  refuses({ FOLDERS_AUTH: '' }, /FOLDERS_AUTH/);
  for (const v of ['Password', 'NONE', 'yes', 'true', '0', 'basic', ' none']) refuses({ FOLDERS_AUTH: v }, /FOLDERS_AUTH/);
});
test('password mode needs a user, a password, and at least 12 characters', () => {
  refuses({ FOLDERS_AUTH: 'password' }, /FOLDERS_USER/);
  refuses({ FOLDERS_AUTH: 'password', FOLDERS_USER: 'a' }, /FOLDERS_USER/);
  refuses({ FOLDERS_AUTH: 'password', FOLDERS_PASSWORD: 'douze-caracteres' }, /FOLDERS_USER/);
  refuses({ FOLDERS_AUTH: 'password', FOLDERS_USER: '  ', FOLDERS_PASSWORD: 'douze-caracteres' }, /FOLDERS_USER/);
  refuses({ ...good, FOLDERS_PASSWORD: '12345678901' }, /12 caract/);
  assert.equal(readConfig({ ...good, FOLDERS_PASSWORD: '123456789012' }).auth, 'password');
});
test('none mode with a user or a password is ambiguous: refused', () => {
  refuses({ FOLDERS_AUTH: 'none', FOLDERS_USER: 'a' }, /ambigu/);
  refuses({ FOLDERS_AUTH: 'none', FOLDERS_PASSWORD: 'douze-caracteres' }, /ambigu/);
  const c = readConfig({ FOLDERS_AUTH: 'none', FOLDERS_USER: '', FOLDERS_PASSWORD: '' }); // Compose passe des variables vides
  assert.equal(c.auth, 'none');
});
test('unknown FOLDERS_ variable (typo) is refused', () => {
  refuses({ ...good, FOLDERS_PASWORD: 'x' }, /FOLDERS_PASWORD/);
  refuses({ ...good, FOLDERS_LIBRARY_DIR: '/x' }, /FOLDERS_LIBRARY_DIR/);
  assert.doesNotThrow(() => readConfig({ ...good, OTHER: 'ok', PATH: '/bin' }));
});
test('numeric limits: non-numeric, negative, fractional, out of range are refused', () => {
  for (const name of ['FOLDERS_PORT', 'FOLDERS_RESCAN_MINUTES', 'FOLDERS_SESSION_HOURS', 'FOLDERS_LOGIN_ATTEMPTS', 'FOLDERS_LOGIN_WINDOW_SECONDS', 'FOLDERS_TRUST_PROXY', 'FOLDERS_PROGRESS_FLUSH_SECONDS']) {
    for (const v of ['abc', '-1', '1.5', '1e3', '0x10', '99999999999']) refuses({ ...good, [name]: v }, new RegExp(name));
  }
  refuses({ ...good, FOLDERS_PORT: '0' }, /FOLDERS_PORT/);
  refuses({ ...good, FOLDERS_PORT: '70000' }, /FOLDERS_PORT/);
  refuses({ ...good, FOLDERS_PROGRESS_FLUSH_SECONDS: '61' }, /FOLDERS_PROGRESS_FLUSH_SECONDS/);
  refuses({ ...good, FOLDERS_LOGIN_ATTEMPTS: '0' }, /FOLDERS_LOGIN_ATTEMPTS/);
  refuses({ ...good, FOLDERS_TRUST_PROXY: '2' }, /FOLDERS_TRUST_PROXY/);
  refuses({ ...good, FOLDERS_COOKIE_PATH: 'folders' }, /COOKIE_PATH/);
  refuses({ ...good, FOLDERS_COOKIE_PATH: '/a; Domain=x' }, /COOKIE_PATH/);
});
test('defaults and valid values', () => {
  const c = readConfig(good);
  assert.deepEqual([c.port, c.rescanMinutes, c.sessionHours, c.loginAttempts, c.loginWindowSeconds, c.trustProxy], [8788, 15, 720, 5, 900, false]);
  assert.deepEqual([c.librariesDir, c.dataDir, c.cookiePath], ['/libraries', '/data', '/']);
  const d = readConfig({ ...good, FOLDERS_RESCAN_MINUTES: '0', FOLDERS_TRUST_PROXY: '1', FOLDERS_COOKIE_PATH: '/folders/' });
  assert.deepEqual([d.rescanMinutes, d.trustProxy, d.cookiePath], [0, true, '/folders/']);
});

test('start() rejects an invalid configuration before opening any port', async () => {
  const fx = fixture();
  await assert.rejects(start({ FOLDERS_LIBRARIES_DIR: fx.libraries, FOLDERS_DATA_DIR: fx.data }, { port: 0 }), ConfigError);
  await assert.rejects(start(env({ FOLDERS_USER: 'x' }, fx), { port: 0 }), ConfigError);
});
test('no library under the libraries directory: refused', async () => {
  const fx = fixture();
  const vide = tmp();
  await assert.rejects(start(env({ FOLDERS_LIBRARIES_DIR: vide }, fx), { port: 0 }), /Aucune bibliothèque/);
  await assert.rejects(start(env({ FOLDERS_LIBRARIES_DIR: join(vide, 'absent') }, fx), { port: 0 }), /Aucune bibliothèque/);
  writeFileSync(join(vide, 'fichier.txt'), 'x'); // un fichier n'est pas une bibliothèque
  await assert.rejects(start(env({ FOLDERS_LIBRARIES_DIR: vide }, fx), { port: 0 }), /Aucune bibliothèque/);
});
test('data directory that cannot be written: refused', async () => {
  const fx = fixture();
  const base = tmp();
  writeFileSync(join(base, 'fichier'), 'x');
  await assert.rejects(start(env({ FOLDERS_DATA_DIR: join(base, 'fichier', 'data') }, fx), { port: 0 }), /pas inscriptible/);
  await assert.rejects(start(env({ FOLDERS_DATA_DIR: join(base, 'fichier') }, fx), { port: 0 }), /pas inscriptible/);
});
test('a valid configuration starts, and creates the signing key in the data directory', async () => {
  const fx = fixture();
  const app = await start(passwordEnv(fx), { port: 0, log: quiet });
  await app.scanned;
  try {
    const { readFileSync, statSync } = await import('node:fs');
    assert.match(readFileSync(join(fx.data, 'secret.key'), 'utf8').trim(), /^[0-9a-f]{64}$/);
    assert.equal(statSync(join(fx.data, 'secret.key')).mode & 0o077, 0);
  } finally { await app.close(); }
});

test('the process refuses to start: exit code 1, one-line message, nothing listening', () => {
  const fx = fixture();
  const run1 = (environment) => spawnSync(process.execPath, ['folders/server.js'], { env: { PATH: process.env.PATH, ...environment }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 10000 });
  const a = run1({ FOLDERS_LIBRARIES_DIR: fx.libraries, FOLDERS_DATA_DIR: fx.data });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /^Configuration invalide : FOLDERS_AUTH/);
  assert.equal(a.stderr.trim().split('\n').length, 1);
  const b = run1({ FOLDERS_AUTH: 'none', FOLDERS_PASSWORD: 'x', FOLDERS_LIBRARIES_DIR: fx.libraries, FOLDERS_DATA_DIR: fx.data });
  assert.equal(b.status, 1);
});

run();
