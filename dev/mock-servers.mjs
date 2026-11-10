#!/usr/bin/env node
// Faux serveurs pour développer et tester Scrollarr sans bibliothèque réelle.
// Sert l'application sur /, une imitation de Komga sur /komga et une imitation
// de Suwayomi sur /suwayomi (voir mock-suwayomi.mjs), comme le fait nginx en
// production. Aucune dépendance : `node dev/mock-servers.mjs`.
//
//   Komga : demo@scrollarr.local / demo — clé d'API (pour le notifier) : demo-key
//   Suwayomi : sans authentification par défaut (SUWA_AUTH pour changer)
//   SERVERS=suwayomi,komga   serveurs « configurés » (défaut : les deux)
//   PORT=8380            port d'écoute
//   NOTIFIER=http://127.0.0.1:8787   relaie /notify/* vers le notifier
//   POST /komga/__mock/add-book?series=<id>   simule l'arrivée d'un chapitre
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createSuwayomiMock } from './mock-suwayomi.mjs';

const PORT = Number(process.env.PORT || 8380);
const ENABLED = (process.env.SERVERS || 'suwayomi,komga').split(',').map((x) => x.trim());
const NOTIFIER = process.env.NOTIFIER || '';
const APP_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'app');
const USER = { id: 'U1', email: 'demo@scrollarr.local', roles: ['ADMIN', 'USER'], sharedAllLibraries: true, sharedLibrariesIds: [], labelsAllow: [], labelsExclude: [] };
const PASSWORD = 'demo';
const API_KEY = 'demo-key';

// ───────────── Données ─────────────
function rng(seed) {
  let a = 0;
  for (const c of String(seed)) a = (Math.imul(a, 31) + c.charCodeAt(0)) | 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = 86400000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const libraries = [{ id: 'L1', name: 'Manga' }, { id: 'L2', name: 'BD' }, { id: 'L3', name: 'Comics' }]
  .map((l) => ({ ...l, root: '/data/' + l.name.toLowerCase(), unavailable: false }));

const seed = [
  ['Les Veilleurs de Brume', 'L1', 38, ['Fantastique', 'Aventure'], 'ONGOING', 'Aya Kurose', 'Dans une vallée où la brume ne se lève jamais, une garde de nuit protège les villages de ce qui rôde au-delà des lanternes.', 268],
  ['Tokyo Minuit Express', 'L1', 24, ['Thriller', 'Tranche de vie'], 'ONGOING', 'Ren Okabe', 'Le dernier train de la ligne circulaire ne s’arrête jamais deux fois à la même gare.', 322],
  ['Lame du Nord', 'L1', 112, ['Action', 'Historique'], 'ENDED', 'Shun Itō', 'Un forgeron exilé remonte vers le nord pour retrouver l’épée qu’il n’aurait jamais dû forger.', 12],
  ['Café Lune Rouge', 'L1', 16, ['Romance', 'Tranche de vie'], 'ONGOING', 'Mio Hanazawa', 'Un café ouvert seulement les nuits de pleine lune, et ses habitués qui n’ont pas tous l’air humains.', 340, true],
  ['Sous la pluie de Shibuya', 'L1', 9, ['Romance', 'Drame'], 'HIATUS', 'Kei Tachibana', 'Deux inconnus partagent un parapluie tous les jeudis sans jamais se demander leur nom.', 205, true],
  ['Le Dernier Cartographe', 'L1', 47, ['Aventure', 'Fantastique'], 'ONGOING', 'Haru Minase', 'Le monde s’efface par les bords. Quelqu’un doit bien le redessiner.', 48],
  ['Orbital 9', 'L1', 31, ['Science-fiction', 'Action'], 'ONGOING', 'Daichi Mori', 'La neuvième station n’apparaît sur aucun registre, et son équipage n’a pas vieilli depuis quarante ans.', 190],
  ['Mlle Renard détective', 'L1', 20, ['Policier', 'Comédie'], 'ONGOING', 'Yuki Aizawa', 'Elle résout toutes les affaires du quartier, à condition qu’on la paie en tofu frit.', 28],
  ['Le Clan des Sept Vents', 'L1', 64, ['Action', 'Fantastique'], 'ENDED', 'Sōta Kaji', 'Sept héritiers, un seul souffle à transmettre.', 150],
  ['Kumo, apprenti yōkai', 'L1', 13, ['Comédie', 'Fantastique'], 'ONGOING', 'Nao Fujimori', 'Kumo voulait devenir un esprit terrifiant. Il fait surtout rire les enfants.', 95, true],
  ['Chroniques d’Ardoise', 'L2', 6, ['Aventure', 'Historique'], 'ENDED', 'Élise Morvan', 'Six albums pour raconter une ville minière et ceux qui l’ont creusée.', 30],
  ['Capitaine Mistral', 'L2', 11, ['Aventure', 'Humour'], 'ONGOING', 'Paul Garrigue', 'Le pire marin de Méditerranée, et pourtant le seul à connaître la route.', 168],
  ['Night Circuit', 'L3', 18, ['Science-fiction', 'Thriller'], 'ONGOING', 'J. Halloran', 'A courier rides the city grid after curfew, carrying parcels nobody should open.', 215],
  ['The Lantern Guard', 'L3', 27, ['Super-héros', 'Action'], 'ONGOING', 'M. Okafor', 'Every district has a lantern. Every lantern has a keeper.', 280],
];

const series = [];
const books = [];
const progress = new Map(); // bookId → { page, completed, readDate }
const clientSettings = {};
let counter = 0;

function addBook(s, n, created) {
  const r = rng(s.id + ':' + n);
  const tall = s.tall;
  const pagesCount = tall ? 6 + Math.floor(r() * 6) : 14 + Math.floor(r() * 12);
  const b = {
    id: 'B' + (++counter).toString(36).toUpperCase().padStart(4, '0'),
    seriesId: s.id, seriesTitle: s.metadata.title, libraryId: s.libraryId,
    name: `Chapitre ${n}`, url: `/data/${s.name}/Chapitre ${n}.cbz`, number: n,
    created: iso(created), lastModified: iso(created), fileLastModified: iso(created),
    sizeBytes: pagesCount * 380000, size: `${(pagesCount * 0.38).toFixed(1)} MiB`,
    media: { status: 'READY', mediaType: 'application/zip', mediaProfile: 'DIVINA', pagesCount, comment: '', epubDivinaCompatible: false, epubIsKepub: false },
    metadata: { title: `Chapitre ${n}`, titleLock: false, summary: '', number: String(n), numberSort: n, releaseDate: iso(created).slice(0, 10), authors: s.booksMetadata.authors, tags: [], links: [], isbn: '', created: iso(created), lastModified: iso(created) },
    deleted: false, fileHash: '', oneshot: false,
    _tall: tall, _hue: s._hue,
  };
  books.push(b);
  s.lastModified = iso(Math.max(Date.parse(s.lastModified), created));
  return b;
}

seed.forEach(([title, libraryId, count, genres, status, author, summary, hue, tall], i) => {
  const created = NOW - (200 - i * 13) * DAY;
  const s = {
    id: 'S' + String(i + 1).padStart(3, '0'), libraryId, name: title, url: '/data/' + title,
    created: iso(created), lastModified: iso(created), fileLastModified: iso(created), deleted: false, oneshot: false,
    metadata: { title, titleSort: title, status, summary, genres, tags: [], language: 'fr', publisher: '', readingDirection: tall ? 'WEBTOON' : 'RIGHT_TO_LEFT', alternateTitles: [], links: [], sharingLabels: [], totalBookCount: status === 'ENDED' ? count : null, created: iso(created), lastModified: iso(created) },
    booksMetadata: { authors: [{ name: author, role: 'writer' }, { name: author, role: 'penciller' }], tags: [], summary: '', summaryNumber: '', notableEntities: [], created: iso(created), lastModified: iso(created) },
    _hue: hue, tall: !!tall,
  };
  series.push(s);
  // Les derniers chapitres arrivent ces jours-ci, pour remplir « Nouveaux chapitres ».
  for (let n = 1; n <= count; n++) addBook(s, n, NOW - (count - n) * (2 + (i % 4)) * DAY - i * 3600000);
});

// Un peu d'historique de lecture pour que l'accueil ait quelque chose à montrer.
function read(seriesIdx, upTo, partial) {
  const list = books.filter((b) => b.seriesId === series[seriesIdx].id);
  list.slice(0, upTo).forEach((b, k) => progress.set(b.id, { page: b.media.pagesCount, completed: true, readDate: iso(NOW - (upTo - k) * 3600000 - seriesIdx * DAY) }));
  if (partial) progress.set(list[upTo].id, { page: partial, completed: false, readDate: iso(NOW - seriesIdx * 5400000) });
}
read(0, 21, 7); read(3, 4, 3); read(6, 30, 0); read(1, 10, 0); read(10, 6, 0);

// ───────────── DTO ─────────────
function bookDto(b) {
  const { _tall, _hue, ...rest } = b;
  const p = progress.get(b.id);
  return p ? { ...rest, readProgress: { ...p, created: p.readDate, lastModified: p.readDate, deviceId: '', deviceName: '' } } : rest;
}
function seriesDto(s) {
  const { _hue, tall, ...rest } = s;
  const list = books.filter((b) => b.seriesId === s.id);
  const read = list.filter((b) => progress.get(b.id)?.completed).length;
  const started = list.filter((b) => progress.has(b.id) && !progress.get(b.id).completed).length;
  return { ...rest, booksCount: list.length, booksReadCount: read, booksInProgressCount: started, booksUnreadCount: list.length - read - started };
}
const bookStatus = (b) => { const p = progress.get(b.id); return !p ? 'UNREAD' : p.completed ? 'READ' : 'IN_PROGRESS'; };
const seriesStatus = (d) => (d.booksCount && d.booksReadCount === d.booksCount ? 'READ' : d.booksReadCount + d.booksInProgressCount === 0 ? 'UNREAD' : 'IN_PROGRESS');

const op = (o, actual) => (o.operator === 'isNot' ? actual !== o.value : actual === o.value);
function matchBook(c, b) {
  if (!c) return true;
  if (c.allOf) return c.allOf.every((x) => matchBook(x, b));
  if (c.anyOf) return c.anyOf.some((x) => matchBook(x, b));
  if (c.seriesId) return op(c.seriesId, b.seriesId);
  if (c.libraryId) return op(c.libraryId, b.libraryId);
  if (c.readStatus) return op(c.readStatus, bookStatus(b));
  return true;
}
function matchSeries(c, d) {
  if (!c) return true;
  if (c.allOf) return c.allOf.every((x) => matchSeries(x, d));
  if (c.anyOf) return c.anyOf.some((x) => matchSeries(x, d));
  if (c.libraryId) return op(c.libraryId, d.libraryId);
  if (c.readStatus) return op(c.readStatus, seriesStatus(d));
  if (c.genre) return c.genre.operator === 'isNot' ? !d.metadata.genres.includes(c.genre.value) : d.metadata.genres.includes(c.genre.value);
  return true;
}
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const getters = {
  'metadata.titleSort': (x) => norm(x.metadata.titleSort || x.metadata.title),
  'metadata.numberSort': (x) => x.metadata.numberSort,
  created: (x) => x.created, createdDate: (x) => x.created,
  lastModified: (x) => x.lastModified, lastModifiedDate: (x) => x.lastModified,
  'readProgress.readDate': (x) => x.readProgress?.readDate || '',
};
function sorted(list, sort) {
  if (!sort) return list;
  const [key, dir] = sort.split(',');
  const get = getters[key];
  if (!get) return list;
  const m = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => (get(a) < get(b) ? -m : get(a) > get(b) ? m : 0));
}
function paged(list, q) {
  if (q.get('unpaged') === 'true') return wrap(list, 0, list.length || 1, list.length);
  const size = Math.max(1, Number(q.get('size') || 20));
  const page = Math.max(0, Number(q.get('page') || 0));
  return wrap(list.slice(page * size, page * size + size), page, size, list.length);
}
function wrap(content, number, size, total) {
  const totalPages = Math.ceil(total / size);
  return { content, number, size, totalElements: total, totalPages, numberOfElements: content.length, first: number === 0, last: number >= totalPages - 1, empty: content.length === 0 };
}

// ───────────── Images (SVG générés) ─────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function lines(text, max) {
  const out = [''];
  for (const w of text.split(' ')) {
    if ((out.at(-1) + ' ' + w).trim().length > max) out.push(w); else out[out.length - 1] = (out.at(-1) + ' ' + w).trim();
  }
  return out;
}
function coverSvg(s, label) {
  const h = s._hue;
  const r = rng('cover' + s.id);
  const title = lines(s.metadata.title, 11);
  const shapes = Array.from({ length: 5 }, (_, i) => {
    const x = r() * 600, y = 260 + r() * 520, w = 120 + r() * 300;
    return `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${40 + r() * 220}" fill="hsl(${(h + i * 28) % 360} 70% ${24 + i * 9}%)" transform="rotate(${-18 + r() * 36} ${x} ${y})"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
<defs><pattern id="d" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="3.2" fill="hsl(${(h + 40) % 360} 90% 72%)"/></pattern></defs>
<rect width="600" height="900" fill="hsl(${h} 62% 15%)"/>${shapes}
<rect y="560" width="600" height="340" fill="url(#d)" opacity=".55"/>
<circle cx="${380 + r() * 120}" cy="${420 + r() * 80}" r="${90 + r() * 70}" fill="hsl(${(h + 180) % 360} 85% 62%)"/>
<rect width="600" height="${70 + title.length * 82}" fill="#fff"/>
${title.map((l, i) => `<text x="34" y="${104 + i * 82}" font-family="Arial Narrow, Arial, sans-serif" font-weight="900" font-size="84" fill="#15141C">${esc(l)}</text>`).join('')}
${label ? `<rect x="0" y="770" width="${150 + String(label).length * 46}" height="130" fill="#15141C"/><text x="28" y="866" font-family="Arial Narrow, Arial, sans-serif" font-weight="900" font-size="104" fill="#fff">#${esc(label)}</text>` : ''}
</svg>`;
}
function pageDims(b) { return b._tall ? { width: 800, height: 2600 } : { width: 800, height: 1150 }; }
function pageSvg(b, n) {
  const { width: W, height: H } = pageDims(b);
  const r = rng(b.id + '/' + n);
  const h = b._hue;
  const m = 34;
  const rows = b._tall ? 6 + Math.floor(r() * 3) : 3 + Math.floor(r() * 2);
  let y = m;
  let out = '';
  const weights = Array.from({ length: rows }, () => 0.6 + r());
  const sum = weights.reduce((a, c) => a + c, 0);
  for (let i = 0; i < rows; i++) {
    const rh = ((H - m * 2 - (rows - 1) * 16) * weights[i]) / sum;
    const cols = b._tall ? 1 : 1 + Math.floor(r() * 2.4);
    let x = m;
    const cw = (W - m * 2 - (cols - 1) * 16) / cols;
    for (let c = 0; c < cols; c++) {
      const kind = Math.floor(r() * 4);
      const fill = kind === 0 ? `hsl(${h} 55% ${28 + r() * 40}%)` : kind === 1 ? 'url(#d)' : kind === 2 ? `hsl(${(h + 170) % 360} 60% ${55 + r() * 25}%)` : '#fff';
      out += `<rect x="${x}" y="${y}" width="${cw}" height="${rh}" fill="${fill}" stroke="#15141C" stroke-width="5"/>`;
      if (r() > 0.35) {
        const bx = x + cw * (0.25 + r() * 0.5), by = y + rh * (0.22 + r() * 0.3);
        out += `<ellipse cx="${bx}" cy="${by}" rx="${Math.min(cw * 0.3, 120)}" ry="${Math.min(rh * 0.16, 54)}" fill="#fff" stroke="#15141C" stroke-width="4"/>`;
        out += `<rect x="${bx - 50}" y="${by - 5}" width="100" height="6" fill="#15141C" opacity=".5"/>`;
      }
      if (r() > 0.6) out += `<circle cx="${x + cw * r()}" cy="${y + rh * (0.6 + r() * 0.3)}" r="${20 + r() * 50}" fill="#15141C"/>`;
      x += cw + 16;
    }
    y += rh + 16;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><pattern id="d" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#fff"/><circle cx="6" cy="6" r="2.6" fill="#15141C"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#fff"/>${out}
<text x="${W - m}" y="${H - 8}" text-anchor="end" font-family="Arial, sans-serif" font-size="20" fill="#15141C">${esc(b.seriesTitle)} · ch. ${b.number} · ${n}</text>
</svg>`;
}

// ───────────── HTTP ─────────────
const sessions = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = body === undefined ? '' : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(data);
}
const svg = (res, body) => send(res, 200, body, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=3600' });
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
function cookie(req, name) {
  const hit = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : undefined;
}

async function api(req, res, path, q) {
  // ── Authentification ──
  let authed = sessions.has(cookie(req, 'KOMGA-SESSION')) || req.headers['x-api-key'] === API_KEY;
  const basic = req.headers.authorization?.startsWith('Basic ') && Buffer.from(req.headers.authorization.slice(6), 'base64').toString();
  const setCookies = [];
  if (!authed && basic) {
    if (basic === `${USER.email}:${PASSWORD}`) {
      const token = randomUUID();
      sessions.add(token);
      setCookies.push(`KOMGA-SESSION=${token}; Path=/; HttpOnly; SameSite=Lax`);
      authed = true;
    }
  }
  const extra = setCookies.length ? { 'Set-Cookie': setCookies } : {};
  if (path === '/__mock/add-book' && req.method === 'POST') {
    const s = series.find((x) => x.id === q.get('series')) || series[0];
    const n = books.filter((b) => b.seriesId === s.id).length + 1;
    return send(res, 200, bookDto(addBook(s, n, Date.now())));
  }
  // Le vrai Komga ajoute « WWW-Authenticate: Basic » ; le proxy nginx le retire pour
  // que le navigateur n'ouvre pas sa propre fenêtre de connexion. On imite le résultat.
  if (!authed) return send(res, 401, { status: 401, error: 'Unauthorized' });

  const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {};
  const json = (data, status = 200) => send(res, status, data, extra);
  let m;

  if (path === '/api/v2/users/me') return json(USER);
  if (path === '/api/logout') { sessions.delete(cookie(req, 'KOMGA-SESSION')); return send(res, 204, undefined, { 'Set-Cookie': 'KOMGA-SESSION=; Path=/; Max-Age=0' }); }
  if (path === '/api/v1/libraries') return json(libraries);
  if (path === '/api/v1/genres') return json([...new Set(series.flatMap((s) => s.metadata.genres))].sort((a, b) => a.localeCompare(b)));
  if (path === '/api/v1/client-settings/user/list') return json(clientSettings);
  if (path === '/api/v1/client-settings/user' && req.method === 'PATCH') {
    const KEY = /^[a-z](?:[a-z0-9_-]*[a-z0-9])*(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])*)*$/; // même règle que Komga
    if (Object.keys(body).some((k) => !KEY.test(k))) return json({ status: 400, message: 'invalid key' }, 400);
    Object.assign(clientSettings, body);
    return send(res, 204);
  }
  if (path === '/api/v1/client-settings/user' && req.method === 'DELETE') {
    for (const k of await readBody(req)) delete clientSettings[k];
    return send(res, 204);
  }

  if (path === '/api/v1/series/list' && req.method === 'POST') {
    let list = series.map(seriesDto).filter((d) => matchSeries(body.condition, d));
    if (body.fullTextSearch) { const needle = norm(body.fullTextSearch); list = list.filter((d) => norm(d.metadata.title).includes(needle)); }
    return json(paged(sorted(list, q.get('sort')), q));
  }
  if (path === '/api/v1/series/new') return json(paged(sorted(series.map(seriesDto), 'created,desc'), q));
  if (path === '/api/v1/series/updated') return json(paged(sorted(series.map(seriesDto), 'lastModified,desc'), q));
  if ((m = path.match(/^\/api\/v1\/series\/([^/]+)(\/thumbnail|\/read-progress)?$/))) {
    const s = series.find((x) => x.id === m[1]);
    if (!s) return json({ status: 404 }, 404);
    if (m[2] === '/thumbnail') return svg(res, coverSvg(s));
    if (m[2] === '/read-progress') {
      for (const b of books.filter((x) => x.seriesId === s.id)) {
        if (req.method === 'POST') progress.set(b.id, { page: b.media.pagesCount, completed: true, readDate: iso(Date.now()) });
        else progress.delete(b.id);
      }
      return send(res, 204);
    }
    return json(seriesDto(s));
  }

  if (path === '/api/v1/books/list' && req.method === 'POST') {
    return json(paged(sorted(books.filter((b) => matchBook(body.condition, b)).map(bookDto), q.get('sort')), q));
  }
  if (path === '/api/v1/books/latest') return json(paged(sorted(books.map(bookDto), 'lastModifiedDate,desc'), q));
  if (path === '/api/v1/books/ondeck') {
    // Premier chapitre non lu des séries entamées, sans chapitre en cours.
    const deck = [];
    for (const s of series) {
      const list = books.filter((b) => b.seriesId === s.id);
      if (!list.some((b) => progress.get(b.id)?.completed) || list.some((b) => bookStatus(b) === 'IN_PROGRESS')) continue;
      const next = list.find((b) => !progress.has(b.id));
      if (next) deck.push(bookDto(next));
    }
    return json(paged(deck, q));
  }
  if ((m = path.match(/^\/api\/v1\/books\/([^/]+)(?:\/(thumbnail|pages|next|previous|read-progress)(?:\/(\d+))?)?$/))) {
    const b = books.find((x) => x.id === m[1]);
    if (!b) return json({ status: 404 }, 404);
    const [, , sub, num] = m;
    if (!sub) return json(bookDto(b));
    if (sub === 'thumbnail') return svg(res, coverSvg(series.find((s) => s.id === b.seriesId), b.number));
    if (sub === 'pages' && num) {
      const n = Number(num);
      if (n < 1 || n > b.media.pagesCount) return json({ status: 404 }, 404);
      return svg(res, pageSvg(b, n));
    }
    if (sub === 'pages') {
      return json(Array.from({ length: b.media.pagesCount }, (_, i) => ({ number: i + 1, fileName: `${String(i + 1).padStart(3, '0')}.svg`, mediaType: 'image/svg+xml', ...pageDims(b), sizeBytes: 380000, size: '371 KiB' })));
    }
    if (sub === 'next' || sub === 'previous') {
      const list = books.filter((x) => x.seriesId === b.seriesId);
      const other = list[list.indexOf(b) + (sub === 'next' ? 1 : -1)];
      return other ? json(bookDto(other)) : json({ status: 404 }, 404);
    }
    if (sub === 'read-progress') {
      if (req.method === 'DELETE') { progress.delete(b.id); return send(res, 204); }
      const completed = body.completed ?? (body.page >= b.media.pagesCount);
      progress.set(b.id, { page: completed ? b.media.pagesCount : body.page ?? 1, completed, readDate: iso(Date.now()) });
      return send(res, 204);
    }
  }
  return json({ status: 404, path }, 404);
}

async function proxy(req, res, target) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const r = await fetch(target, { method: req.method, headers: { 'content-type': req.headers['content-type'] || '', cookie: req.headers.cookie || '' }, body: chunks.length ? Buffer.concat(chunks) : undefined });
    send(res, r.status, Buffer.from(await r.arrayBuffer()), { 'Content-Type': r.headers.get('content-type') || 'application/json' });
  } catch { send(res, 502, { error: 'notifier unreachable' }); }
}

const suwayomi = createSuwayomiMock({ rng, coverSvg, pageSvg, send, svg, readBody, cookie });

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/servers.json') {
      return send(res, 200, { komga: ENABLED.includes('komga'), suwayomi: ENABLED.includes('suwayomi') }, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname.startsWith('/komga/')) {
      if (!ENABLED.includes('komga')) return send(res, 404, { error: 'not configured' });
      return await api(req, res, url.pathname.slice(6), url.searchParams);
    }
    if (url.pathname.startsWith('/suwayomi/')) {
      if (!ENABLED.includes('suwayomi')) return send(res, 404, { error: 'not configured' });
      return await suwayomi(req, res, url.pathname.slice(9), url.searchParams);
    }
    if (url.pathname.startsWith('/notify/')) {
      if (!NOTIFIER) return send(res, 404, { error: 'notifier not configured' });
      return await proxy(req, res, NOTIFIER + url.pathname.slice(7) + url.search);
    }
    let file = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.)+/, '');
    if (!file || file.endsWith('/')) file += 'index.html';
    const data = await readFile(join(APP_DIR, file)).catch(() => null);
    if (!data) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(res, 200, data, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e) });
  }
}).listen(PORT, () => console.log(`Scrollarr (démo) : http://localhost:${PORT}  —  ${USER.email} / ${PASSWORD}`));
