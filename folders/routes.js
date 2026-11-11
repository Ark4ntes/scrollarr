// Routes HTTP du service (READ-002 §4.4), étapes A et B : session, santé, structure, pages, couvertures.
// Les objets suivent le modèle commun de l'application (celui de Komga).
// Aucun chemin n'entre ni ne sort : seulement des identifiants.
import { send, readJson, checkCrossOrigin, clientAddress, notModified, sendNotModified, sendImage, HttpError } from './http.js';
import { isSeriesId, isBookId } from './ids.js';
import { stripLabels } from './naming.js';
import { Unavailable, NotFound } from './library.js';

const iso = (ms) => new Date(ms).toISOString();
const SORT = /^(metadata\.titleSort|name|lastModified|created)(?:,(asc|desc))?$/;
const PROFILE = /^[A-Za-z0-9]{1,32}$/;
const PAGE_NUMBER = /^[1-9]\d{0,5}$/; // à partir de 1, comme Komga

const seriesDto = (s, lib) => ({
  id: s.id, libraryId: lib.id, name: s.title, created: iso(s.created), lastModified: iso(s.lastModified),
  booksCount: s.chapters.length, metadata: { title: s.title, titleSort: stripLabels(s.title) },
});
const bookDto = (c, s, lib) => ({
  id: c.id, seriesId: s.id, seriesTitle: s.title, libraryId: lib.id, name: c.name, number: c.number,
  created: iso(c.created), lastModified: iso(c.lastModified), sizeBytes: c.size,
  media: { mediaType: c.kind === 'archive' ? 'application/zip' : 'inode/directory', pagesCount: c.pages },
  metadata: { title: c.title, number: c.numberText, numberSort: c.numberSort },
});

function intParam(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new HttpError(400, `paramètre ${name} invalide`);
  return Number(raw);
}

export function createHandler({ config, auth, libraries, reading, version }) {
  /** Répond 304 si le client a la bonne version, sinon envoie l'image en flux. */
  async function serve(req, res, source) {
    if (notModified(req, source)) return sendNotModified(res, source);
    return sendImage(res, source, await source.stream());
  }

  async function route(req, res, url) {
    const path = url.pathname;
    const get = req.method === 'GET';

    if (get && path === '/health') {
      return send(res, 200, { ok: true, version, auth: config.auth, libraries: libraries.health() });
    }

    // ── Session ──
    if (path === '/api/v1/session' && get) {
      if (!auth.required) return send(res, 200, { authenticated: true, user: null, auth: 'none' });
      const user = auth.user(req);
      return user ? send(res, 200, { authenticated: true, user, auth: 'password' }) : send(res, 401, { error: 'unauthorized' });
    }
    if (path === '/api/v1/login' && req.method === 'POST') {
      if (!auth.required) throw new HttpError(400, 'authentification désactivée');
      const address = clientAddress(req, config.trustProxy);
      const wait = auth.blocked(address);
      if (wait) return send(res, 429, { error: 'too many attempts' }, { 'Retry-After': String(wait) });
      const body = await readJson(req);
      if (!auth.check(address, body.username, body.password)) return send(res, 401, { error: 'invalid credentials' });
      return send(res, 200, { authenticated: true, user: config.user }, { 'Set-Cookie': auth.cookie(req, config.user) });
    }
    if (path === '/api/v1/logout' && req.method === 'POST') {
      await readJson(req);
      return send(res, 204, null, auth.required ? { 'Set-Cookie': auth.cookie(req, null) } : {});
    }

    // Tout le reste exige une session en mode password.
    if (auth.required && !auth.user(req)) return send(res, 401, { error: 'unauthorized' });

    if (get && path === '/api/v1/libraries') return send(res, 200, libraries.libraries());

    if (get && path === '/api/v1/series') {
      const sort = url.searchParams.get('sort') || 'metadata.titleSort,asc';
      if (!SORT.test(sort)) throw new HttpError(400, 'paramètre sort invalide');
      if (url.searchParams.get('status')) throw new HttpError(400, 'filtre status non pris en charge');
      const profile = url.searchParams.get('profile');
      if (profile !== null && !PROFILE.test(profile)) throw new HttpError(400, 'paramètre profile invalide');
      const page = intParam(url, 'page', 0, 0, 1e6);
      const size = intParam(url, 'size', 30, 1, 500);
      const library = url.searchParams.get('library') || undefined;
      const result = await libraries.listSeries({ library, search: url.searchParams.get('search') || '', sort, page, size });
      return send(res, 200, {
        content: result.content.map(({ s, l }) => seriesDto(s, l)),
        last: result.last, totalElements: result.total, number: page, size,
      });
    }

    let m;
    if (get && (m = /^\/api\/v1\/series\/([^/]+)(\/books)?$/.exec(path))) {
      if (!isSeriesId(m[1])) throw new NotFound('identifiant inconnu');
      const { lib, series } = await libraries.getSeries(m[1]);
      if (!m[2]) return send(res, 200, seriesDto(series, lib));
      const content = series.chapters.map((c) => bookDto(c, series, lib));
      return send(res, 200, { content, last: true, totalElements: content.length });
    }

    if (get && (m = /^\/api\/v1\/books\/([^/]+)(?:\/(next|previous))?$/.exec(path))) {
      if (!isBookId(m[1])) throw new NotFound('identifiant inconnu');
      const { lib, series, chapter, index } = await libraries.getBook(m[1]);
      if (!m[2]) return send(res, 200, bookDto(chapter, series, lib));
      const other = series.chapters[index + (m[2] === 'next' ? 1 : -1)];
      if (!other) throw new NotFound('pas de chapitre voisin');
      return send(res, 200, bookDto(other, series, lib));
    }

    // ── Contenus : liste des pages, page, couverture ──
    if (get && (m = /^\/api\/v1\/books\/([^/]+)\/pages(?:\/([^/]+))?$/.exec(path))) {
      if (!isBookId(m[1]) || (m[2] !== undefined && !PAGE_NUMBER.test(m[2]))) throw new NotFound('identifiant inconnu');
      const { lib, series, chapter } = await libraries.getBook(m[1]);
      return libraries.guard(m[1], async () => {
        const target = await libraries.target(lib, series, chapter);
        if (m[2] === undefined) {
          const pages = await reading.pages(target);
          if (chapter.kind === 'archive') libraries.rememberPages(chapter, pages.length);
          return send(res, 200, pages);
        }
        const source = await reading.source(target, Number(m[2]));
        if (!source) throw new NotFound('page introuvable');
        if (source.pageCount !== undefined) libraries.rememberPages(chapter, source.pageCount);
        return serve(req, res, source);
      });
    }
    // Couverture : une seule image par série. Celle d'un chapitre est celle de sa série (§4.5).
    if (get && (m = /^\/api\/v1\/(series|books)\/([^/]+)\/thumbnail$/.exec(path))) {
      if (!(m[1] === 'series' ? isSeriesId(m[2]) : isBookId(m[2]))) throw new NotFound('identifiant inconnu');
      const { lib, series } = m[1] === 'series' ? await libraries.getSeries(m[2]) : await libraries.getBook(m[2]);
      return libraries.guard(series.id, async () => {
        const file = await libraries.coverFile(lib, series);
        const source = file ? await reading.fileSource(file)
          : await reading.source(await libraries.target(lib, series, series.chapters[0]), 1); // sinon : première page du premier chapitre
        if (!source) throw new NotFound('pas de couverture');
        return serve(req, res, source);
      });
    }

    if (path === '/api/v1/scan' && get) return send(res, 200, libraries.status());
    if (path === '/api/v1/scan' && req.method === 'POST') {
      await readJson(req);
      libraries.scanAll(true); // en arrière-plan ; l'état se lit par GET /api/v1/scan
      return send(res, 202, { ...libraries.status(), running: true });
    }

    throw new NotFound('route inconnue');
  }

  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, POST' });
      checkCrossOrigin(req);
      await route(req, res, new URL(req.url, 'http://x'));
    } catch (e) {
      if (res.headersSent) return res.destroy(); // erreur en cours de flux : on ne peut plus changer le statut
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof NotFound) return send(res, 404, { error: 'not found' });
      if (e instanceof Unavailable) return send(res, 503, { error: 'library unavailable' }, { 'Retry-After': '5' });
      console.error(e);
      send(res, 500, { error: 'internal error' });
    }
  };
}
