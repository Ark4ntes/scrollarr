// Aides communes aux tests du service folders (pas de framework de test).
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from '../dev/make-folders-fixture.mjs';
import { start } from '../folders/app.js';

const dirs = [];
process.on('exit', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
export const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'folders-test-')); dirs.push(d); return d; };
export const fixture = (opts) => makeFixture(tmp(), opts);
export const quiet = { log() {}, warn() {}, error() {} };

/** Suite séquentielle : test(nom, fn async), puis run() imprime PASS/FAIL et fixe le code de sortie. */
export function suite(title) {
  const tests = [];
  return {
    test: (name, fn) => tests.push([name, fn]),
    async run() {
      let failed = 0;
      for (const [name, fn] of tests) {
        try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n  ')); }
      }
      console.log(failed ? `\n${failed} test(s) failed (${title})` : `\nAll ${title} tests passed (${tests.length})`);
      process.exit(failed ? 1 : 0);
    },
  };
}

const PASSWORD = 'mot-de-passe-de-test';
export const CREDENTIALS = { username: 'lecteur', password: PASSWORD };
export const env = (extra = {}, fx) => ({
  FOLDERS_AUTH: 'none', FOLDERS_LIBRARIES_DIR: fx.libraries, FOLDERS_DATA_DIR: fx.data, ...extra,
});
export const passwordEnv = (fx, extra = {}) => env({ FOLDERS_AUTH: 'password', FOLDERS_USER: 'lecteur', FOLDERS_PASSWORD: PASSWORD, ...extra }, fx);

/** Démarre le service sur un port libre ; TTL à zéro par défaut pour voir tout de suite les changements. */
export async function boot(environment, overrides = {}) {
  const app = await start(environment, { port: 0, listTtlMs: 0, seriesTtlMs: 0, retryMs: 0, log: quiet, ...overrides });
  await app.scanned;
  return app;
}

/** Requête HTTP brute (en-têtes libres, cookies à la charge de l'appelant). */
export function request(app, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: app.port, method, path, headers: { ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* corps vide ou non JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
export const JSON_POST = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
export const get = (app, path, headers) => request(app, 'GET', path, { headers });
export const post = (app, path, body = {}, headers = {}) => request(app, 'POST', path, { headers: { ...JSON_POST, ...headers }, body });

// ── Contenus (étape B) ──
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Écrit un fichier (dossiers parents créés) et rend son chemin. */
export function put(root, rel, data) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}
/** Concatène le corps d'une source de page (résultat de `source.stream()`). */
export async function readBody({ body }) {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}
/** Empreinte d'un dossier : noms, tailles, dates. Sert à prouver qu'on n'y a rien écrit. */
export function snapshot(dir) {
  return JSON.stringify(readdirSync(dir).sort().map((n) => { const s = statSync(join(dir, n)); return [n, s.size, s.mtimeMs, s.ino]; }));
}
/** Descripteurs ouverts par ce processus (Linux) ; null ailleurs. */
export function openFds() {
  try { return readdirSync('/proc/self/fd').length; } catch { return null; }
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
