// Aides communes aux tests du service notifier (pas de framework de test) : faux serveurs
// (dev/mock-servers.mjs), vrai notifier (notifier/server.js) lancés en processus séparés,
// ports libres, journal du service, attente de la fin d'une vérification.
import { spawn } from 'node:child_process';
import { statSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createECDH, randomBytes } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const children = new Set();
const dirs = [];
process.on('exit', () => {
  for (const c of children) c.kill('SIGKILL');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
export const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'notifier-test-')); dirs.push(d); return d; };

/** Suite séquentielle : test(nom, fn async), puis run() imprime PASS/FAIL et fixe le code de sortie. */
export function suite(title) {
  const tests = [];
  return {
    test: (name, fn) => tests.push([name, fn]),
    async run() {
      let failed = 0;
      for (const [name, fn] of tests) {
        try { await fn(); console.log('PASS ' + name); } catch (e) {
          failed++;
          const detail = (e.stack || e.message).split('\n').slice(0, 5).join('\n  ');
          console.log('FAIL ' + name + '\n  ' + detail);
          if (process.env.GITHUB_ACTIONS) console.log(`::error title=${title}::FAIL ${name} ${String(e.message).replace(/\s+/g, ' ').slice(0, 400)}`);
        }
      }
      console.log(failed ? `\n${failed} test(s) failed (${title})` : `\nAll ${title} tests passed (${tests.length})`);
      process.exit(failed ? 1 : 0);
    },
  };
}

const handedOut = new Set();
/** Un port libre ; jamais deux fois le même dans ce processus (les démarrages en parallèle ne se disputent pas). */
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    });
    if (!handedOut.has(port)) { handedOut.add(port); return port; }
  }
}

async function waitPort(port, child, what) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${what} s'est arrêté (code ${child.exitCode})`);
    const ok = await new Promise((resolve) => { const s = createServer(); s.once('error', () => resolve(true)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(false))); });
    if (ok) return;
    await sleep(50);
  }
  throw new Error(`${what} n'écoute pas sur ${port}`);
}

// ───────────── Faux serveurs ─────────────
export const KOMGA_LOGIN = { email: 'demo@scrollarr.local', password: 'demo' };

/**
 * Lance le serveur de démonstration. `auth` : mode d'authentification de Suwayomi (none, basic, simple, ui) ;
 * `servers` : serveurs « configurés ». Le notifier s'y connecte par /suwayomi et /komga.
 */
export async function startMock({ auth = 'none', servers = 'suwayomi,komga', port, env = {} } = {}) {
  port ||= await freePort();
  const child = spawn('node', ['dev/mock-servers.mjs'], {
    cwd: ROOT, stdio: 'ignore',
    env: { PATH: process.env.PATH, PORT: String(port), SUWA_AUTH: auth, SERVERS: servers, ...env },
  });
  children.add(child);
  await waitPort(port, child, 'le faux serveur');
  const url = `http://127.0.0.1:${port}`;
  const post = (path) => fetch(url + path, { method: 'POST' }).then((r) => r.json());
  return {
    port, url, suwayomiUrl: url + '/suwayomi', komgaUrl: url + '/komga', auth,
    /** Un chapitre arrive dans la série Suwayomi n° `manga` ; renvoie le chapitre créé. */
    addChapter: (manga) => post(`/suwayomi/__mock/add-chapter?manga=${manga}`),
    /** Un chapitre arrive dans la série Komga `series` (ex. S001). */
    addBook: (series) => post(`/komga/__mock/add-book?series=${series}`),
    /** Panne simulée : deny = refus, off = fin de la panne. */
    outage: (mode) => post(`/__mock/outage?mode=${mode}`),
    requests: () => fetch(url + '/suwayomi/__mock/requests').then((r) => r.json()),
    async stop() {
      if (child.exitCode === null) { child.kill('SIGKILL'); await new Promise((resolve) => child.once('exit', resolve)); }
      children.delete(child);
    },
  };
}

// ───────────── Sessions d'appelants ─────────────
/** Cookie de session Komga, obtenu comme le navigateur (connexion Basic) ; null si refusé. */
export async function komgaCookie(mock, { email = KOMGA_LOGIN.email, password = KOMGA_LOGIN.password } = {}) {
  const res = await fetch(mock.komgaUrl + '/api/v2/users/me', { headers: { Authorization: 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64') } });
  return res.ok ? res.headers.getSetCookie()[0].split(';')[0] : null;
}
/** Cookie « basic » de Suwayomi tel que l'écrit l'application (valeur Base64 encodée pour un cookie). */
export const suwayomiBasicCookie = (user = 'demo', password = 'demo') => 'scrollarr_suwa_basic=' + encodeURIComponent(Buffer.from(`${user}:${password}`).toString('base64'));
/** Cookie de jeton de Suwayomi en mode « UI login ». */
export async function suwayomiTokenCookie(mock, { username = 'demo', password = 'demo' } = {}) {
  const res = await fetch(mock.suwayomiUrl + '/api/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName: 'Login', variables: { username, password }, query: 'mutation Login($username: String!, $password: String!) { login(input: { username: $username, password: $password }) { accessToken } }' }),
  });
  const token = (await res.json()).data?.login?.accessToken;
  return token ? 'suwayomi-server-token=' + token : null;
}
/** Jeton bien formé mais expiré depuis longtemps (le faux serveur ne lit que la date d'expiration). */
export const expiredTokenCookie = () => 'suwayomi-server-token=h.' + Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url') + '.s';

// ───────────── Notifier ─────────────
/**
 * Lance le vrai notifier avec PUSH_DRY_RUN=1, un dossier de données jetable et une vérification toutes les 3 s
 * (le minimum du service). `env` complète ou remplace. Rend aussi le journal et les lignes « PUSH ».
 */
export async function startNotifier({ dataDir, env = {}, port, expectExit = false } = {}) {
  port ||= await freePort();
  dataDir ||= tmp();
  const child = spawn('node', ['notifier/server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, POLL_MINUTES: '0.05', PUSH_DRY_RUN: '1', ...env },
  });
  children.add(child);
  const log = [];
  let partial = '';
  const onData = (chunk) => {
    partial += chunk;
    const parts = partial.split('\n');
    partial = parts.pop();
    log.push(...parts);
  };
  child.stdout.setEncoding('utf8').on('data', onData);
  child.stderr.setEncoding('utf8').on('data', onData);
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const n = {
    port, dataDir, log, exited, child, url: `http://127.0.0.1:${port}`,
    /** Notifications annoncées jusqu'ici : { userId, payload }. */
    pushes: () => log.filter((l) => l.startsWith('PUSH ')).map((l) => {
      const [, userId, ...rest] = l.split(' ');
      return { userId, payload: JSON.parse(rest.join(' ')) };
    }),
    seenFile: join(dataDir, 'seen.json'),
    /** Attend que `count` vérifications aient été menées à terme (seen.json est réécrit à chacune). */
    async polled(count = 1) {
      const stamp = () => { try { return statSync(n.seenFile, { bigint: true }).mtimeNs; } catch { return 0n; } };
      let last = stamp();
      const deadline = Date.now() + 30000;
      for (let done = 0; done < count;) {
        if (Date.now() > deadline) throw new Error('aucune vérification en 30 s');
        if (child.exitCode !== null) throw new Error('le notifier s\'est arrêté');
        await sleep(40);
        const now = stamp();
        if (now !== last) { last = now; done++; }
      }
      await sleep(250); // les envois suivent l'écriture de seen.json
    },
    /** Deux vérifications : la seconde a forcément commencé après l'appel. */
    settle: () => n.polled(2),
    call: (method, path, opts) => call(n, method, path, opts),
    post: (path, body, opts) => call(n, 'POST', path, { ...opts, body }),
    async stop() {
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
      children.delete(child);
    },
  };
  if (expectExit) return n;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('le notifier n\'a pas démarré : ' + log.join(' | '))), 15000);
    const watch = setInterval(() => { if (log.some((l) => l.includes('à l\'écoute'))) { clearTimeout(timer); clearInterval(watch); resolve(); } }, 30);
    exited.then(({ code }) => { clearTimeout(timer); clearInterval(watch); reject(new Error(`le notifier s'est arrêté (code ${code}) : ` + log.join(' | '))); });
  });
  await ready;
  return n;
}

/** Requête HTTP brute vers le notifier. `body` : objet (JSON) ou chaîne telle quelle. */
export function call(n, method, path, { cookie, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { ...(cookie ? { Cookie: cookie } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: n.port, method, path, headers: h }, (res) => {
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

/** Abonnement Web Push factice mais bien formé (clé P-256 réelle, secret d'authentification de 16 octets). */
export function fakeSubscription(endpoint) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  // La clé privée de l'appareil sert à déchiffrer ce que le service envoie ; elle n'est jamais sérialisée.
  return Object.defineProperty({ endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'deviceKey', { value: ecdh.getPrivateKey() });
}

// ───────────── Faux service Web Push (HTTPS local) ─────────────
// Le notifier envoie vraiment (PUSH_DRY_RUN absent) vers une adresse https:// : on lui en donne une, locale, dont le
// certificat auto-signé est déclaré par NODE_EXTRA_CA_CERTS. Aucun vrai service de push n'est contacté.
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { hkdfSync, createDecipheriv } from 'node:crypto';

let cert;
/** Certificat auto-signé pour 127.0.0.1 (openssl, présent sur les machines de développement et de CI). */
export function pushCert() {
  if (!cert) {
    const dir = tmp();
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    cert = { certFile: join(dir, 'cert.pem'), keyFile: join(dir, 'key.pem') };
  }
  return cert;
}

/**
 * Faux service de push : /<statut> répond avec ce statut (/201, /410…), /refused coupe la connexion.
 * `requests` garde, pour chaque envoi reçu, le chemin, les en-têtes et le corps chiffré.
 */
export async function startPushService() {
  const { certFile, keyFile } = pushCert();
  const requests = [];
  const server = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const status = Number(req.url.split('/')[1]);
      if (!status) return req.socket.destroy();
      res.writeHead(status); res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { port, requests, certFile, endpoint: (status, id = randomBytes(4).toString('hex')) => `https://127.0.0.1:${port}/${status}/${id}`, stop: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}

/** Déchiffre un message Web Push (RFC 8291, aes128gcm) reçu par le faux service, avec la clé privée de l'abonnement factice. */
export function decryptPush(subscription, body) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(subscription.deviceKey);
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const serverKey = body.subarray(21, 21 + idLen);
  const data = body.subarray(21 + idLen);
  const uaKey = Buffer.from(subscription.keys.p256dh, 'base64url');
  const secret = ecdh.computeSecret(serverKey);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(subscription.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), uaKey, serverKey]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce).setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
}
