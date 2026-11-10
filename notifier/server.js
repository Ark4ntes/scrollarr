// Scrollarr notifier — envoie une notification push quand un chapitre arrive
// dans une série suivie. Service facultatif, placé derrière le même proxy que
// l'application (chemin /notify/).
//
// Variables d'environnement (au moins un serveur) :
//   SUWAYOMI_URL    adresse interne de Suwayomi, ex. http://suwayomi:4567
//   SUWAYOMI_USER, SUWAYOMI_PASSWORD   seulement si Suwayomi demande une authentification
//   KOMGA_URL       adresse interne de Komga, ex. http://komga:25600
//   KOMGA_API_KEY   clé d'API Komga utilisée pour surveiller les ajouts
//   VAPID_SUBJECT   contact exigé par le protocole Web Push, ex. mailto:vous@exemple.fr
//   POLL_MINUTES    intervalle entre deux vérifications (défaut : 10)
//   DATA_DIR        dossier persistant (clés VAPID, abonnements) (défaut : /data)
//   PORT            port d'écoute (défaut : 8787)
//   PUSH_DRY_RUN    « 1 » pour journaliser les envois au lieu de les émettre (tests)
import http from 'node:http';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import webpush from 'web-push';

const KOMGA_URL = (process.env.KOMGA_URL || '').replace(/\/$/, '');
const KOMGA_API_KEY = process.env.KOMGA_API_KEY || '';
const SUWAYOMI_URL = (process.env.SUWAYOMI_URL || '').replace(/\/$/, '');
const SUWAYOMI_USER = process.env.SUWAYOMI_USER || '';
const SUWAYOMI_PASSWORD = process.env.SUWAYOMI_PASSWORD || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
const POLL_MS = Math.max(0.05, Number(process.env.POLL_MINUTES || 10)) * 60000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const PORT = Number(process.env.PORT || 8787);
const DRY_RUN = process.env.PUSH_DRY_RUN === '1';

if (!SUWAYOMI_URL && !(KOMGA_URL && KOMGA_API_KEY)) {
  console.error('Renseignez SUWAYOMI_URL, ou KOMGA_URL avec KOMGA_API_KEY.');
  process.exit(1);
}

// ───────────── Persistance ─────────────
async function load(name, fallback) {
  try { return JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')); } catch { return fallback; }
}
async function save(name, data) {
  const file = join(DATA_DIR, name);
  await writeFile(file + '.tmp', JSON.stringify(data));
  await rename(file + '.tmp', file);
}

await mkdir(DATA_DIR, { recursive: true });
let vapid = await load('vapid.json', null);
if (!vapid?.publicKey) {
  vapid = webpush.generateVAPIDKeys();
  await save('vapid.json', vapid);
  console.log('Clés VAPID générées.');
}
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

/** endpoint → { subscription, userId, favorites: [seriesId], lang } */
const subs = new Map(Object.entries(await load('subscriptions.json', {})));
const saveSubs = () => save('subscriptions.json', Object.fromEntries(subs));
/** null tant que la première vérification n'a pas servi de point de départ. */
let seen = await load('seen.json', null);

// ───────────── Envoi ─────────────
const TEXT = {
  fr: { one: (b) => `Nouveau chapitre : ${b}`, many: (n) => `${n} nouveaux chapitres`, test: 'Les notifications fonctionnent.' },
  en: { one: (b) => `New chapter: ${b}`, many: (n) => `${n} new chapters`, test: 'Notifications are working.' },
};
const text = (lang) => TEXT[lang] || TEXT.en;

async function push(sub, payload) {
  if (DRY_RUN) { console.log('PUSH', sub.userId, JSON.stringify(payload)); return; }
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 86400 });
  } catch (e) {
    // 404/410 : l'abonnement n'existe plus côté navigateur.
    if (e.statusCode === 404 || e.statusCode === 410) { subs.delete(sub.subscription.endpoint); await saveSubs(); } else console.warn('Envoi échoué :', e.statusCode || e.message);
  }
}

// ───────────── Serveurs surveillés ─────────────
// Chaque source sait lister ses derniers chapitres et reconnaître la session
// d'un appelant. Les identifiants portent le même préfixe que dans l'application.
const cookieOf = (req, name) => {
  const hit = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : '';
};

const komga = KOMGA_URL && KOMGA_API_KEY && {
  id: 'komga',
  async latest() {
    const res = await fetch(`${KOMGA_URL}/api/v1/books/list?size=200&sort=createdDate,desc`, {
      method: 'POST',
      headers: { 'X-API-Key': KOMGA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('Komga a répondu ' + res.status);
    return ((await res.json()).content || []).map((b) => ({
      id: 'k:' + b.id, seriesId: 'k:' + b.seriesId, seriesTitle: b.seriesTitle, title: b.metadata?.title || b.name, created: Date.parse(b.created),
    }));
  },
  async whoami(req) {
    if (!req.headers.cookie) return null;
    const res = await fetch(`${KOMGA_URL}/api/v2/users/me`, {
      headers: { Cookie: req.headers.cookie, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? 'komga:' + (await res.json()).id : null;
  },
};

const LATEST = `query Latest($first: Int!) {
  chapters(filter: { inLibrary: { equalTo: true } }, orderBy: FETCHED_AT, orderByType: DESC, first: $first) {
    nodes { id name mangaId fetchedAt manga { id title } }
  }
}`;
const PROBE = 'query Probe { categories(first: 1) { totalCount } }';
const LOGIN = 'mutation Login($username: String!, $password: String!) { login(input: { username: $username, password: $password }) { accessToken } }';

const suwayomi = SUWAYOMI_URL && {
  id: 'suwayomi',
  token: null,
  /** Renvoie les données, ou null si Suwayomi refuse la session. */
  async gql(query, variables, headers) {
    const res = await fetch(`${SUWAYOMI_URL}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify({ operationName: /^(?:query|mutation) (\w+)/.exec(query)?.[1], query, variables }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('Suwayomi a répondu ' + res.status);
    const json = await res.json();
    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join(' ; ');
      if (/unauthori[sz]ed/i.test(message)) return null;
      throw new Error('Suwayomi : ' + message);
    }
    return json.data;
  },
  /** Requête au nom du service : sans authentification, puis Basic, puis jeton (mode « UI login »). */
  async asService(query, variables) {
    const basic = SUWAYOMI_USER ? { Authorization: 'Basic ' + Buffer.from(`${SUWAYOMI_USER}:${SUWAYOMI_PASSWORD}`).toString('base64') } : null;
    const attempts = [this.token ? { Authorization: 'Bearer ' + this.token } : {}, basic].filter(Boolean);
    for (const headers of attempts) {
      const data = await this.gql(query, variables, headers);
      if (data) return data;
    }
    if (SUWAYOMI_USER) {
      const login = await this.gql(LOGIN, { username: SUWAYOMI_USER, password: SUWAYOMI_PASSWORD }).catch(() => null);
      if (login?.login?.accessToken) {
        this.token = login.login.accessToken;
        const data = await this.gql(query, variables, { Authorization: 'Bearer ' + this.token });
        if (data) return data;
      }
    }
    throw new Error('Suwayomi refuse la connexion : vérifiez SUWAYOMI_USER et SUWAYOMI_PASSWORD');
  },
  async latest() {
    const data = await this.asService(LATEST, { first: 200 });
    return data.chapters.nodes.map((c) => ({
      id: `s:${c.mangaId}.${c.id}`, seriesId: 's:' + c.mangaId, seriesTitle: c.manga.title, title: c.name, created: Number(c.fetchedAt) * 1000,
    }));
  },
  /** L'appelant est reconnu si ses propres cookies ouvrent une requête protégée de Suwayomi. */
  async whoami(req) {
    const headers = {};
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    // Même conversion que celle du proxy nginx : cookie « basic » → en-tête Authorization.
    const basic = cookieOf(req, 'scrollarr_suwa_basic');
    if (basic) headers.Authorization = 'Basic ' + decodeURIComponent(basic);
    return (await this.gql(PROBE, undefined, headers)) ? 'suwayomi' : null;
  },
};

const sources = [suwayomi, komga].filter(Boolean);

async function poll() {
  seen = seen?.ids && seen.baseline ? seen : { since: Date.now(), ids: [], baseline: {} };
  const fresh = [];
  for (const src of sources) {
    let items;
    try { items = await src.latest(); }
    catch (e) { console.warn(`Vérification de ${src.id} impossible :`, e.message); continue; }
    const known = new Set(seen.ids);
    if (!seen.baseline[src.id]) {
      // Premier passage sur ce serveur : on mémorise l'existant sans rien annoncer.
      seen.baseline[src.id] = Date.now();
      seen.ids.push(...items.map((b) => b.id).filter((id) => !known.has(id)));
      continue;
    }
    // La date d'ajout écarte les anciens chapitres qui remontent dans la liste après une suppression.
    const added = items.filter((b) => !known.has(b.id) && !(b.created < seen.baseline[src.id] - 3600000));
    seen.ids.unshift(...added.map((b) => b.id));
    fresh.push(...added);
  }
  seen.ids = seen.ids.slice(0, 10000);
  await save('seen.json', seen);
  if (!fresh.length) return 0;

  // Une notification par série, même si plusieurs chapitres arrivent d'un coup.
  const bySeries = new Map();
  for (const b of fresh) (bySeries.get(b.seriesId) || bySeries.set(b.seriesId, []).get(b.seriesId)).push(b);
  let sent = 0;
  for (const [seriesId, list] of bySeries) {
    for (const sub of [...subs.values()]) {
      if (!sub.favorites.includes(seriesId)) continue;
      const tx = text(sub.lang);
      await push(sub, {
        title: list[0].seriesTitle,
        body: list.length === 1 ? tx.one(list[0].title) : tx.many(list.length),
        tag: 'series-' + seriesId,
        path: '/series/' + seriesId,
      });
      sent++;
    }
  }
  return sent;
}

async function loop() {
  try { const n = await poll(); if (n) console.log(`${n} notification(s) envoyée(s).`); }
  catch (e) { console.warn('Vérification impossible :', e.message); }
  setTimeout(loop, POLL_MS);
}

// ───────────── API ─────────────
/** Vérifie la session de l'appelant auprès des serveurs configurés, grâce à ses cookies. */
async function whoami(req) {
  for (const src of sources) {
    const user = await src.whoami(req).catch(() => null);
    if (user) return { id: user };
  }
  return null;
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body ?? {}));
};
const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, subscriptions: subs.size });
    if (req.method === 'GET' && path === '/vapid') return send(res, 200, { publicKey: vapid.publicKey });
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

    const user = await whoami(req);
    if (!user) return send(res, 401, { error: 'unauthorized' });
    const body = await readJson(req);
    if (!body) return send(res, 400, { error: 'bad request' });

    if (path === '/subscribe') {
      if (!validSub(body.subscription)) return send(res, 400, { error: 'invalid subscription' });
      const favorites = Array.isArray(body.favorites) ? body.favorites.filter((x) => typeof x === 'string').slice(0, 2000) : [];
      subs.set(body.subscription.endpoint, {
        subscription: { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } },
        userId: user.id, favorites, lang: body.lang === 'fr' ? 'fr' : 'en',
      });
      await saveSubs();
      return send(res, 200, { ok: true, favorites: favorites.length });
    }
    // Les actions suivantes ne portent que sur les abonnements de l'appelant.
    const sub = subs.get(body.endpoint);
    if (!sub || sub.userId !== user.id) return send(res, 404, { error: 'unknown subscription' });
    if (path === '/unsubscribe') { subs.delete(body.endpoint); await saveSubs(); return send(res, 200, { ok: true }); }
    if (path === '/test') {
      await push(sub, { title: 'Scrollarr', body: text(sub.lang).test, tag: 'test', path: '/my/subscriptions' });
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'internal error' });
  }
}).listen(PORT, () => {
  console.log(`Serveurs surveillés : ${sources.map((x) => x.id).join(', ')}.`);
  console.log(`Notifier à l'écoute sur ${PORT}, vérification toutes les ${Math.round(POLL_MS / 6000) / 10} min.`);
  loop();
});
