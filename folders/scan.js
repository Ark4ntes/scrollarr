// Lecture des dossiers (READ-002 §4.1) : séries d'une bibliothèque, chapitres
// d'une série. Ne fait que lire (readdir, lstat) ; ne suit aucun lien symbolique.
// Les chemins `rel` sont relatifs à la racine de la bibliothèque, avec les noms
// bruts du système de fichiers ; ils ne quittent pas le service (voir ids.js).
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isIgnoredName, isImageName, isArchiveName, isCoverName, displayName, stripExtension } from './naming.js';

export const MAX_DEPTH = 3;

const badName = (name) => name.includes('�'); // octets non UTF-8 remplacés à la lecture
const times = (st) => ({ mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs });

/** Exécute `fn` sur les éléments par petits lots, pour ne pas saturer un disque lent. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Séries candidates d'une bibliothèque : sous-dossiers directs et archives à la
 * racine (série d'un seul chapitre). Une seule lecture de répertoire, plus un
 * lstat par entrée. Lève l'erreur du système si la racine est illisible.
 */
export async function listRoot(root) {
  const warnings = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const found = [];
  for (const e of entries) {
    if (isIgnoredName(e.name)) continue;
    if (badName(e.name)) { warnings.push({ code: 'invalid-name', entry: displayName(e.name) }); continue; }
    if (e.isSymbolicLink()) { warnings.push({ code: 'symlink', entry: displayName(e.name) }); continue; }
    if (e.isDirectory()) found.push({ rel: e.name, kind: 'dir', title: displayName(e.name) });
    else if (e.isFile() && isArchiveName(e.name)) found.push({ rel: e.name, kind: 'archive', title: displayName(stripExtension(e.name)) });
  }
  await mapLimit(found, 16, async (f) => {
    try { Object.assign(f, times(await fs.lstat(join(root, f.rel)))); } catch { f.gone = true; }
  });
  return { entries: found.filter((f) => !f.gone), warnings };
}

/**
 * Chapitres d'une série. Retourne { chapters, warnings, mtimeMs, birthtimeMs }.
 * Chaque chapitre : { rel, kind: 'dir'|'archive', name, parents, pages, size, mtimeMs, birthtimeMs }.
 * `rel` d'une série-archive est le fichier lui-même.
 */
export async function scanSeries(root, series) {
  const warnings = [];
  const warn = (code, entry) => warnings.push({ code, entry: displayName(entry) });
  const base = join(root, series.rel);
  const st = await fs.lstat(base);
  const out = { warnings, ...times(st), chapters: [] };

  if (series.kind === 'archive') {
    if (st.size === 0) warn('empty-archive', series.rel);
    else out.chapters.push({ rel: series.rel, kind: 'archive', name: series.title, parents: [], pages: null, size: st.size, ...times(st) });
    return out;
  }

  let looseImages = 0;
  async function visit(rel, depth, parents) {
    const entries = await fs.readdir(join(root, rel), { withFileTypes: true });
    const images = [], archives = [], dirs = [];
    for (const e of entries) {
      if (isIgnoredName(e.name)) continue;
      if (badName(e.name)) { warn('invalid-name', e.name); continue; }
      if (e.isSymbolicLink()) { warn('symlink', e.name); continue; }
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.isFile() && isArchiveName(e.name)) archives.push(e.name);
      else if (e.isFile() && isImageName(e.name)) images.push(e.name);
    }
    if (depth === 0) { looseImages = images.filter((n) => !isCoverName(n)).length; }
    else if (images.length > 0) {
      // Un dossier qui contient directement des images est un chapitre ; on ne descend pas plus bas.
      const s = await fs.lstat(join(root, rel));
      out.chapters.push({ rel, kind: 'dir', name: displayName(rel.split('/').pop()), parents, pages: images.length, size: null, ...times(s) });
      return;
    } else if (archives.length === 0 && dirs.length === 0) { warn('empty', rel.split('/').pop()); return; }

    const here = depth === 0 ? [] : [...parents, displayName(rel.split('/').pop())];
    for (const name of archives) {
      if (depth + 1 > MAX_DEPTH) { warn('too-deep', name); continue; }
      const crel = `${rel}/${name}`;
      const s = await fs.lstat(join(root, crel));
      if (s.size === 0) { warn('empty-archive', name); continue; }
      out.chapters.push({ rel: crel, kind: 'archive', name: displayName(stripExtension(name)), parents: here, pages: null, size: s.size, ...times(s) });
    }
    for (const name of dirs) {
      if (depth + 1 > MAX_DEPTH) { warn('too-deep', name); continue; }
      await visit(`${rel}/${name}`, depth + 1, here);
    }
  }
  await visit(series.rel, 0, []);

  if (out.chapters.length === 0 && looseImages > 0) {
    // Images directement dans le dossier de la série : un chapitre unique du nom de la série.
    out.chapters.push({ rel: series.rel, kind: 'dir', name: series.title, parents: [], pages: looseImages, size: null, ...times(st) });
  } else if (looseImages > 0) {
    warn('loose-images', series.title);
  }
  return out;
}
