// Index en mémoire des bibliothèques, séries et chapitres (READ-002 §4.8).
// Principe : relister ce que l'on affiche. Aucun cache sur disque, aucune
// décision fondée sur la date d'un dossier parent. Une bibliothèque illisible,
// ou vide alors qu'elle a déjà contenu des séries, devient « indisponible » :
// les routes répondent 503, jamais 404 (un 404 ferait supprimer l'abonnement).
import { listRoot, scanSeries, mapLimit } from './scan.js';
import { libraryId, seriesId, bookId, seriesOfBook, createRegistry, confine, confineFile, ConfinementError, isBookId } from './ids.js';
import { compareSegments, compareNames, detectNumber, numberSorts, searchKey } from './naming.js';

export class Unavailable extends Error {}
export class NotFound extends Error {}

/** Erreur du système de fichiers (EIO, EACCES…), par opposition à une erreur de format. */
const isFsError = (e) => typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code);

/** `onScan` : appelé à chaque parcours complet (les listes d'entrées d'archives sont alors jetées, §4.8). */
export function createLibraries({ config, mounts, flags, log = console, onScan = () => {} }) {
  const now = () => Date.now();
  const placeholder = (m) => ({ name: m.name, id: libraryId(m.name), root: m.root, state: 'scanning', listedAt: 0, series: new Map(), warnings: [], pending: null });
  let libs = new Map(mounts.map((m) => [m.name, placeholder(m)]));
  let registry = createRegistry();
  let initial = null; // parcours de démarrage
  let running = null; // parcours complet en cours
  let lastScan = null;
  // Nombre de pages des archives déjà ouvertes (lecture du répertoire central) : sans cela il reviendrait à
  // `null` à chaque relecture de la série. Valable tant que la taille et la date de l'archive ne changent pas.
  const knownPages = new Map();

  // ── Construction d'une série à partir d'un parcours ──
  function makeSeries(lib, entry, scanned, reg) {
    const sid = seriesId(lib.name, entry.rel);
    const ordered = scanned.chapters
      .map((c) => ({ ...c, segments: [...c.parents, c.name] }))
      .sort((a, b) => compareSegments(a.segments, b.segments));
    const sorts = numberSorts(ordered.map((c) => detectNumber(c.name, entry.title)));
    const chapters = [];
    const byId = new Map();
    ordered.forEach((c, i) => {
      const id = bookId(lib.name, entry.rel, c.rel);
      if (byId.has(id)) return; // collision d'empreinte : pratiquement impossible, on ignore le doublon
      const number = detectNumber(c.name, entry.title);
      const chapter = {
        id, kind: c.kind, name: c.name, title: c.segments.join(' / '),
        number: i + 1, numberText: number === null ? '' : String(number), numberSort: sorts[i],
        pages: c.pages ?? rememberedPages(id, c), size: c.size, created: c.birthtimeMs, lastModified: c.mtimeMs,
      };
      chapters.push(chapter);
      byId.set(id, chapter);
      reg.add(id, lib.name, c.rel);
    });
    reg.add(sid, lib.name, entry.rel);
    return {
      id: sid, kind: entry.kind, title: entry.title, cover: scanned.cover ?? null, chapters, byId, scannedAt: now(),
      created: scanned.birthtimeMs, lastModified: Math.max(scanned.mtimeMs, ...chapters.map((c) => c.lastModified)),
      warnings: scanned.warnings,
    };
  }
  function rememberedPages(id, c) {
    const known = knownPages.get(id);
    return known && known.size === c.size && known.mtimeMs === c.mtimeMs ? known.count : null;
  }
  function dropSeries(lib, sid, reg = registry) {
    const s = lib.series.get(sid);
    if (s) for (const c of s.chapters) reg.remove(c.id);
    reg.remove(sid);
    lib.series.delete(sid);
  }

  // ── Lecture d'une bibliothèque ──
  /** Met la bibliothèque à jour. Les séries déjà connues ne sont relues que si `rescanAll`. */
  async function populate(lib, reg, { rescanAll = false, manual = false } = {}) {
    let listing;
    try { listing = await listRoot(lib.root); } catch (e) {
      lib.state = 'unavailable'; lib.listedAt = now();
      return;
    }
    const { entries, warnings } = listing;
    if (entries.length === 0 && flags.hadSeries(lib.name) && !manual) { lib.state = 'unavailable'; lib.listedAt = now(); return; }

    const known = new Set();
    const libWarnings = warnings.map((w) => ({ ...w }));
    const wanted = entries.filter((e) => { const sid = seriesId(lib.name, e.rel); known.add(sid); return rescanAll || !lib.series.has(sid); });
    const results = await mapLimit(wanted, 8, (e) => scanSeries(lib.root, e).catch((error) => ({ error })));
    wanted.forEach((e, i) => {
      const r = results[i];
      if (r.error) libWarnings.push({ code: 'unreadable', entry: e.title });
      else if (r.chapters.length === 0) { libWarnings.push({ code: 'no-chapters', entry: e.title }); for (const w of r.warnings) libWarnings.push({ ...w, series: e.title }); }
      else lib.series.set(seriesId(lib.name, e.rel), makeSeries(lib, e, r, reg));
    });
    for (const sid of [...lib.series.keys()]) if (!known.has(sid)) dropSeries(lib, sid, reg);

    lib.warnings = libWarnings;
    lib.state = 'ok';
    lib.listedAt = now();
    if (lib.series.size > 0) await flags.set(lib.name, true);
    else if (manual) await flags.set(lib.name, false);
  }

  function refreshLibrary(lib, { force = false, manual = false } = {}) {
    const age = now() - lib.listedAt;
    if (!force && lib.state === 'ok' && age < config.listTtlMs) return Promise.resolve();
    if (!force && lib.state === 'unavailable' && age < config.retryMs) return Promise.resolve();
    if (!lib.pending) lib.pending = populate(lib, registry, { manual }).finally(() => { lib.pending = null; });
    return lib.pending;
  }

  // ── Parcours complet : le nouvel index remplace l'ancien d'un coup ──
  function scanAll(manual = false) {
    if (running) return running;
    const startedAt = now();
    running = (async () => {
      const fresh = new Map();
      const reg = createRegistry();
      for (const m of mounts) {
        const lib = placeholder(m);
        await populate(lib, reg, { rescanAll: true, manual });
        if (lib.state === 'unavailable') {
          // On garde ce qu'on savait : les identifiants de cette bibliothèque restent reconnus (503, pas 404).
          const old = libs.get(m.name);
          lib.series = old.series; lib.warnings = old.warnings;
          for (const [sid, s] of old.series) {
            const loc = registry.locate(sid);
            if (loc) reg.add(sid, loc.library, loc.rel);
            for (const c of s.chapters) { const l = registry.locate(c.id); if (l) reg.add(c.id, l.library, l.rel); }
          }
        }
        fresh.set(m.name, lib);
      }
      libs = fresh; registry = reg;
      onScan();
      lastScan = { startedAt, finishedAt: now() };
      const t = totals();
      log.log(`Parcours terminé : ${t.series} séries, ${t.books} chapitres, ${t.warningsCount} avertissements, ${lastScan.finishedAt - startedAt} ms.`);
      for (const w of allWarnings().slice(0, 100)) log.warn(`Avertissement [${w.library}] ${w.code} : ${w.series ? w.series + ' / ' : ''}${w.entry}`);
    })().catch((e) => log.error('Parcours en échec :', e)).finally(() => { running = null; });
    return running;
  }
  const start = () => { initial = scanAll(false); return initial; };

  function maybeBackgroundScan() {
    if (config.rescanMinutes > 0 && !running && lastScan && now() - lastScan.finishedAt > config.rescanMinutes * 60000) scanAll(false);
  }

  function allWarnings() {
    const out = [];
    for (const lib of libs.values()) {
      for (const w of lib.warnings) out.push({ library: lib.name, ...w });
      for (const s of lib.series.values()) for (const w of s.warnings) out.push({ library: lib.name, series: s.title, ...w });
    }
    return out;
  }
  function totals() {
    let series = 0, books = 0;
    for (const lib of libs.values()) for (const s of lib.series.values()) { series++; books += s.chapters.length; }
    return { series, books, warningsCount: allWarnings().length };
  }

  // ── Accès ──
  const anyUnavailable = () => [...libs.values()].some((l) => l.state === 'unavailable');

  async function libraryOfSeries(sid) {
    await initial;
    let loc = registry.locate(sid);
    if (!loc) { await Promise.all([...libs.values()].map((l) => refreshLibrary(l))); loc = registry.locate(sid); }
    // Identifiant inconnu alors qu'une bibliothèque est indisponible : on ne peut pas savoir qu'il n'existe pas.
    if (!loc) throw anyUnavailable() ? new Unavailable('bibliothèque indisponible') : new NotFound('série introuvable');
    const lib = libs.get(loc.library);
    if (lib.state === 'unavailable') { await refreshLibrary(lib); if (lib.state === 'unavailable') throw new Unavailable('bibliothèque indisponible'); }
    return lib;
  }

  /** Relit une série si sa dernière lecture est trop ancienne (ou si `force`). */
  async function refreshSeries(lib, sid, force = false) {
    const current = lib.series.get(sid);
    if (!current) throw new NotFound('série introuvable');
    if (!force && now() - current.scannedAt < config.seriesTtlMs) return { series: current, fresh: false };
    const loc = registry.locate(sid);
    const entry = { rel: loc.rel, kind: current.kind, title: current.title };
    let scanned;
    try { await confine(lib.root, loc.rel); scanned = await scanSeries(lib.root, entry); } catch {
      // Disparue ou illisible : on relit la bibliothèque pour savoir pourquoi.
      await refreshLibrary(lib, { force: true });
      if (lib.state === 'unavailable') throw new Unavailable('bibliothèque indisponible');
      if (!lib.series.has(sid)) throw new NotFound('série introuvable');
      throw new Unavailable('série illisible');
    }
    if (scanned.chapters.length === 0) { dropSeries(lib, sid); throw new NotFound('série introuvable'); }
    dropSeries(lib, sid);
    const series = makeSeries(lib, entry, scanned, registry);
    lib.series.set(sid, series);
    return { series, fresh: true };
  }

  // ── Lecture des contenus (étape B) : où lire, et que faire quand le fichier a changé ──
  /** Ce qu'il faut lire pour un chapitre : { kind, path (chemin réel confiné), skipCover }. Lève l'erreur du système si le fichier a disparu. */
  async function target(lib, series, chapter) {
    const loc = registry.locate(chapter.id);
    const path = await (chapter.kind === 'archive' ? confineFile : confine)(lib.root, loc.rel);
    // Images directement dans le dossier de la série : cover.* n'est pas une page.
    return { kind: chapter.kind, path, skipCover: chapter.kind === 'dir' && loc.rel === registry.locate(series.id).rel };
  }
  /**
   * Exécute une lecture sur `id` (série ou chapitre). Fichier disparu ou remplacé par un lien : la série est
   * relue tout de suite, puis 404. Autre erreur du système de fichiers : 503, jamais 404 (§4.8).
   */
  async function guard(id, work) {
    try { return await work(); } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR' || e?.code === 'ELOOP' || e instanceof ConfinementError) {
        const sid = isBookId(id) ? seriesOfBook(id) : id;
        await refreshSeries(await libraryOfSeries(sid), sid, true); // lève Unavailable ou NotFound s'il y a lieu
        throw new NotFound('introuvable');
      }
      if (isFsError(e)) throw new Unavailable('fichier illisible');
      throw e;
    }
  }

  return {
    start,
    scanAll,
    target,
    guard,
    /** Mémorise le nombre de pages d'une archive (connu après son ouverture). */
    rememberPages(chapter, count) {
      chapter.pages = count;
      knownPages.set(chapter.id, { size: chapter.size, mtimeMs: chapter.lastModified, count });
      if (knownPages.size > 20000) knownPages.delete(knownPages.keys().next().value);
    },
    /** Fichier de couverture d'une série (cover.*), ou null : alors c'est la première page du premier chapitre. */
    async coverFile(lib, series) {
      return series.cover ? confineFile(lib.root, `${registry.locate(series.id).rel}/${series.cover}`) : null;
    },
    maybeBackgroundScan,
    libraries: () => [...libs.values()].map((l) => ({ id: l.id, name: l.name })).sort((a, b) => compareNames(a.name, b.name)),
    health: () => [...libs.values()].map((l) => ({ name: l.name, state: l.state })),
    status() {
      return { running: running !== null, lastScan, ...totals(), warnings: allWarnings().slice(0, 1000) };
    },

    /** `keep` : prédicat facultatif sur une série (filtre par état de lecture), appliqué avant la pagination. */
    async listSeries({ library, search = '', sort = 'metadata.titleSort,asc', page = 0, size = 30, keep }) {
      await initial;
      const targets = library ? [...libs.values()].filter((l) => l.id === library) : [...libs.values()];
      if (library && targets.length === 0) throw new NotFound('bibliothèque introuvable');
      await Promise.all(targets.map((l) => refreshLibrary(l)));
      if (targets.some((l) => l.state === 'unavailable')) throw new Unavailable('bibliothèque indisponible');
      maybeBackgroundScan();
      const needle = searchKey(search.trim());
      let items = targets.flatMap((l) => [...l.series.values()].map((s) => ({ s, l })));
      if (needle) items = items.filter(({ s }) => searchKey(s.title).includes(needle));
      if (keep) items = items.filter(({ s }) => keep(s));
      const [key, dir] = sort.split(',');
      const sign = dir === 'desc' ? -1 : 1;
      const byTitle = (a, b) => compareNames(a.s.title, b.s.title) || compareNames(a.l.name, b.l.name);
      const by = key === 'lastModified' ? (a, b) => (a.s.lastModified - b.s.lastModified) * sign || byTitle(a, b)
        : key === 'created' ? (a, b) => (a.s.created - b.s.created) * sign || byTitle(a, b)
          : (a, b) => byTitle(a, b) * sign;
      items.sort(by);
      const content = items.slice(page * size, page * size + size);
      return { content, total: items.length, last: (page + 1) * size >= items.length };
    },

    async getSeries(sid) {
      const lib = await libraryOfSeries(sid);
      const { series } = await refreshSeries(lib, sid);
      return { lib, series };
    },

    async getBook(bid) {
      const lib = await libraryOfSeries(seriesOfBook(bid));
      let { series, fresh } = await refreshSeries(lib, seriesOfBook(bid));
      // Un chapitre disparu entre la liste et l'ouverture : la série est relue tout de suite.
      if (!series.byId.has(bid) && !fresh) ({ series } = await refreshSeries(lib, seriesOfBook(bid), true));
      const chapter = series.byId.get(bid);
      if (!chapter) throw new NotFound('chapitre introuvable');
      return { lib, series, chapter, index: series.chapters.indexOf(chapter) };
    },
  };
}
