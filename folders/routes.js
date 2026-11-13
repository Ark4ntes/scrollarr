// Routes HTTP du service (READ-002 §4.4), étapes A à C2 : session, santé, structure, pages, couvertures, progression.
// Les objets suivent le modèle commun de l'application (celui de Komga).
// Aucun chemin n'entre ni ne sort : seulement des identifiants.
import { send, readJson, checkCrossOrigin, clientAddress, notModified, sendNotModified, sendImage, HttpError } from './http.js';
import { isSeriesId, isBookId, seriesOfBook } from './ids.js';
import { stripLabels } from './naming.js';
import { Unavailable, NotFound } from './library.js';
import { MAIN, ProfileLimit, ProgressUnavailable } from './progress.js';

const iso = (ms) => new Date(ms).toISOString();
const SORT = /^(metadata\.titleSort|name|lastModified|created)(?:,(asc|desc))?$/;
const PROFILE = /^[A-Za-z0-9]{1,32}$/;
const STATUS = /^(UNREAD|IN_PROGRESS|READ)$/;
const PAGE_NUMBER = /^[1-9]\d{0,5}$/; // à partir de 1, comme Komga

/** Chapitres lus et entamés d'une série pour un profil (`recs` : table chapitre → enregistrement, ou undefined). */
function counts(s, recs) {
  let read = 0, started = 0;
  if (recs) for (const c of s.chapters) { const r = recs.get(c.id); if (r) { if (r.completed) read++; else started++; } }
  return { read, started };
}
const statusOf = (s, recs) => {
  const { read, started } = counts(s, recs);
  return s.chapters.length > 0 && read === s.chapters.length ? 'READ' : read + started === 0 ? 'UNREAD' : 'IN_PROGRESS';
};
const seriesDto = (s, lib, recs) => {
  const { read, started } = counts(s, recs);
  return {
    id: s.id, libraryId: lib.id, name: s.title, created: iso(s.created), lastModified: iso(s.lastModified),
    booksCount: s.chapters.length, booksReadCount: read, booksInProgressCount: started, booksUnreadCount: s.chapters.length - read - started,
    metadata: { title: s.title, titleSort: stripLabels(s.title) },
  };
};
// Un chapitre-archive ne connaît son nombre de pages qu'après sa première ouverture : celui qui a été enregistré
// avec la progression le remplace tant que l'archive n'a pas été rouverte depuis le démarrage.
const bookDto = (c, s, lib, rec) => ({
  id: c.id, seriesId: s.id, seriesTitle: s.title, libraryId: lib.id, name: c.name, number: c.number,
  created: iso(c.created), lastModified: iso(c.lastModified), sizeBytes: c.size,
  media: { mediaType: c.kind === 'archive' ? 'application/zip' : 'inode/directory', pagesCount: c.pages ?? rec?.pages ?? null },
  metadata: { title: c.title, number: c.numberText, numberSort: c.numberSort },
  ...(rec ? { readProgress: { page: rec.page, completed: rec.completed, readDate: iso(rec.date) } } : {}),
});

function intParam(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new HttpError(400, `paramètre ${name} invalide`);
  return Number(raw);
}

/**
 * Enregistrement issu du corps d'un PATCH `{ page?, completed? }` : `completed` seul marque terminé (page = dernière) ;
 * `page` seule est terminée si elle atteint le nombre de pages connu ; une page au-delà du nombre de pages est ramenée à la dernière.
 */
function recordFrom(body, chapter, prev, now = Date.now()) {
  const { page, completed } = body;
  if (page !== undefined && (!Number.isInteger(page) || page < 1 || page > 1e6)) throw new HttpError(400, 'paramètre page invalide');
  if (completed !== undefined && typeof completed !== 'boolean') throw new HttpError(400, 'paramètre completed invalide');
  if (page === undefined && completed !== true) throw new HttpError(400, 'page ou completed: true requis');
  const pages = chapter.pages ?? prev?.pages ?? null; // connu : dossier d'images, ou archive déjà ouverte
  const done = completed ?? (pages !== null && page >= pages);
  let at = page ?? pages ?? prev?.page ?? 1;
  if (pages !== null && (at > pages || done)) at = pages;
  return { page: at, completed: done, date: now, pages };
}

export function createHandler({ config, auth, libraries, reading, progress, version }) {
  /** Répond 304 si le client a la bonne version, sinon envoie l'image en flux. */
  async function serve(req, res, source) {
    if (notModified(req, source)) return sendNotModified(res, source);
    return sendImage(res, source, await source.stream());
  }

  /** Profil de la requête (`?profile=`), `main` par défaut. */
  function profileOf(url) {
    const profile = url.searchParams.get('profile');
    if (profile === null) return MAIN;
    if (!PROFILE.test(profile)) throw new HttpError(400, 'paramètre profile invalide');
    return profile;
  }

  /**
   * Chapitres entamés (`open`) ou tous ceux qui ont une progression, du plus récent au plus ancien. Un chapitre
   * disparu ou renommé est sauté (sa progression est gardée) ; si une bibliothèque est indisponible et qu'il n'y a
   * rien à montrer, la réponse est 503, jamais une liste vide qui laisserait croire qu'il n'y a rien.
   */
  async function recentBooks(profile, size, open) {
    const out = [];
    let unavailable = null;
    let tried = 0;
    for (const { bid, rec } of await progress.recent(profile, open ? { completed: false } : {})) {
      if (out.length >= size || tried++ >= 200) break;
      try {
        const { lib, series, chapter } = await libraries.getBook(bid);
        out.push(bookDto(chapter, series, lib, rec));
      } catch (e) {
        if (e instanceof Unavailable) unavailable = e;
        else if (!(e instanceof NotFound)) throw e;
      }
    }
    if (!out.length && unavailable) throw unavailable;
    return { content: out };
  }

  async function route(req, res, url) {
    const path = url.pathname;
    const get = req.method === 'GET';

    if (get && path === '/health') {
      // Sans session : seulement ce qu'une sonde de santé exige. Mode d'authentification, version et état des
      // bibliothèques sont servis par /api/v1/status, derrière la session.
      return send(res, 200, { ok: true });
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

    // Détails que /health ne donne plus : version du service, mode d'authentification, état de chaque bibliothèque.
    if (get && path === '/api/v1/status') return send(res, 200, { version, auth: config.auth, libraries: libraries.health() });

    if (get && path === '/api/v1/libraries') return send(res, 200, libraries.libraries());

    if (get && path === '/api/v1/series') {
      const sort = url.searchParams.get('sort') || 'metadata.titleSort,asc';
      if (!SORT.test(sort)) throw new HttpError(400, 'paramètre sort invalide');
      const status = url.searchParams.get('status') || '';
      if (status && !STATUS.test(status)) throw new HttpError(400, 'paramètre status invalide');
      const recs = await progress.snapshot(profileOf(url));
      const page = intParam(url, 'page', 0, 0, 1e6);
      const size = intParam(url, 'size', 30, 1, 1000); // l'application demande jusqu'à 1000 séries par page pour fusionner les listes
      const library = url.searchParams.get('library') || undefined;
      const keep = status ? (s) => statusOf(s, recs.get(s.id)) === status : undefined;
      const result = await libraries.listSeries({ library, search: url.searchParams.get('search') || '', sort, page, size, keep });
      return send(res, 200, {
        content: result.content.map(({ s, l }) => seriesDto(s, l, recs.get(s.id))),
        last: result.last, totalElements: result.total, number: page, size,
      });
    }

    let m;
    // Listes dérivées de la progression. Avant la route d'un chapitre : « inprogress » n'est pas un identifiant.
    if (get && (m = /^\/api\/v1\/books\/(inprogress|recent)$/.exec(path))) {
      const profile = profileOf(url);
      return send(res, 200, await recentBooks(profile, intParam(url, 'size', 20, 1, 200), m[1] === 'inprogress'));
    }

    if (get && (m = /^\/api\/v1\/series\/([^/]+)(\/books)?$/.exec(path))) {
      if (!isSeriesId(m[1])) throw new NotFound('identifiant inconnu');
      const recs = (await progress.snapshot(profileOf(url))).get(m[1]);
      const { lib, series } = await libraries.getSeries(m[1]);
      if (!m[2]) return send(res, 200, seriesDto(series, lib, recs));
      const content = series.chapters.map((c) => bookDto(c, series, lib, recs?.get(c.id)));
      return send(res, 200, { content, last: true, totalElements: content.length });
    }

    if (get && (m = /^\/api\/v1\/books\/([^/]+)(?:\/(next|previous))?$/.exec(path))) {
      if (!isBookId(m[1])) throw new NotFound('identifiant inconnu');
      const recs = (await progress.snapshot(profileOf(url))).get(seriesOfBook(m[1]));
      const { lib, series, chapter, index } = await libraries.getBook(m[1]);
      if (!m[2]) return send(res, 200, bookDto(chapter, series, lib, recs?.get(chapter.id)));
      const other = series.chapters[index + (m[2] === 'next' ? 1 : -1)];
      if (!other) throw new NotFound('pas de chapitre voisin');
      return send(res, 200, bookDto(other, series, lib, recs?.get(other.id)));
    }

    // ── Oubli de la progression d'un profil supprimé (la liste des profils est tenue par l'application) ──
    if (req.method === 'DELETE' && (m = /^\/api\/v1\/profiles\/([^/]+)\/progress$/.exec(path))) {
      await readJson(req);
      // Le profil principal est l'historique commun : il ne se supprime pas, un identifiant mal formé n'est pas un profil.
      if (!PROFILE.test(m[1]) || m[1] === MAIN) throw new HttpError(400, 'profil invalide');
      await progress.forgetProfile(m[1]);
      return send(res, 204, null);
    }

    // ── Progression : écritures (PATCH / DELETE d'un chapitre, PUT / DELETE d'une série) ──
    if ((m = /^\/api\/v1\/books\/([^/]+)\/progress$/.exec(path)) && (req.method === 'PATCH' || req.method === 'DELETE')) {
      if (!isBookId(m[1])) throw new NotFound('identifiant inconnu');
      const profile = profileOf(url);
      const body = await readJson(req);
      const { series, chapter } = await libraries.getBook(m[1]); // un chapitre inconnu n'a pas de progression
      if (req.method === 'DELETE') {
        await progress.clear(profile, series.id, [chapter.id]);
        return send(res, 204, null);
      }
      const prev = (await progress.snapshot(profile)).get(series.id)?.get(chapter.id);
      await progress.setMany(profile, series.id, [[chapter.id, recordFrom(body, chapter, prev)]]);
      return send(res, 204, null);
    }
    if ((m = /^\/api\/v1\/series\/([^/]+)\/progress$/.exec(path)) && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!isSeriesId(m[1])) throw new NotFound('identifiant inconnu');
      const profile = profileOf(url);
      await readJson(req);
      const { series } = await libraries.getSeries(m[1]);
      if (req.method === 'DELETE') {
        await progress.clear(profile, series.id, series.chapters.map((c) => c.id));
      } else {
        // Les chapitres déjà terminés gardent leur date : « tout marquer lu » ne les remet pas en tête de l'historique.
        const recs = (await progress.snapshot(profile)).get(series.id);
        const now = Date.now();
        const entries = series.chapters.filter((c) => !recs?.get(c.id)?.completed).map((c) => [c.id, recordFrom({ completed: true }, c, recs?.get(c.id), now)]);
        await progress.setMany(profile, series.id, entries);
      }
      return send(res, 204, null);
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
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, POST, PATCH, PUT, DELETE' });
      checkCrossOrigin(req);
      await route(req, res, new URL(req.url, 'http://x'));
    } catch (e) {
      if (res.headersSent) return res.destroy(); // erreur en cours de flux : on ne peut plus changer le statut
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof NotFound) return send(res, 404, { error: 'not found' });
      if (e instanceof ProfileLimit) return send(res, 400, { error: 'too many profiles' });
      if (e instanceof Unavailable || e instanceof ProgressUnavailable) return send(res, 503, { error: 'library unavailable' }, { 'Retry-After': '5' });
      console.error(e);
      send(res, 500, { error: 'internal error' });
    }
  };
}
