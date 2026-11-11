// Lecture des pages (READ-002 §4.2, §4.8, §4.10) : liste des pages d'un chapitre,
// et « source » d'une page, c'est-à-dire ce qu'il faut savoir pour répondre
// (validateurs HTTP, taille) avant de lire le moindre octet, puis le flux lui-même.
// Les chemins reçus sont déjà confinés (voir ids.js) ; rien n'est écrit nulle part.
import { promises as fs, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { createArchives, openReadOnly, versionOf, classify, LIMITS } from './archive.js';
import { compareSegments, isImageName, isIgnoredName, isCoverName } from './naming.js';
import { sniffImage, SNIFF_BYTES, hintFromName } from './sniff.js';

const etagOf = (...parts) => `"${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24)}"`;

/** Refus avant toute lecture : image vide (415), entrée trop grosse ou taux de compression suspect (413). */
function checkSize(size, compressed) {
  if (size === 0) throw new HttpError(415, 'unsupported media type');
  if (size > LIMITS.maxEntryBytes) throw new HttpError(413, 'image too large');
  if (size > LIMITS.ratioFloorBytes && size / Math.max(compressed, 1) > LIMITS.maxRatio) throw new HttpError(413, 'image compression ratio too high');
}

/**
 * Lit les premiers octets, décide du type, et rend le flux complet. Le type vient du contenu, jamais de
 * l'extension. Le corps refuse de dépasser ou de rester en deçà de la taille annoncée (Content-Length).
 */
async function sniffed(stream, size) {
  const it = stream[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  try {
    while (head.length < SNIFF_BYTES) {
      const r = await it.next();
      if (r.done) break;
      head = Buffer.concat([head, r.value]);
    }
  } catch (e) { stream.destroy(); throw classify(e); }
  const mediaType = sniffImage(head);
  if (!mediaType) { stream.destroy(); throw new HttpError(415, 'unsupported media type'); }
  async function* body() {
    try {
      let sent = head.length;
      yield head;
      for (;;) {
        const r = await it.next();
        if (r.done) break;
        sent += r.value.length;
        if (sent > size) throw new Error('stream longer than announced');
        yield r.value;
      }
      if (sent !== size) throw new Error('stream shorter than announced');
    } finally { stream.destroy(); }
  }
  return { mediaType, body: body() };
}

export function createReading() {
  const archives = createArchives();

  /** Images d'un dossier-chapitre, en tri naturel. Mêmes règles que le parcours (scan.js). */
  async function folderImages({ path, skipCover }) {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !isIgnoredName(e.name) && !e.name.includes('�') && isImageName(e.name) && !(skipCover && isCoverName(e.name)))
      .map((e) => e.name)
      .sort((a, b) => compareSegments([a], [b]));
  }

  /** Source d'un fichier image ordinaire (page d'un dossier, ou cover.*). */
  async function fileSource(path) {
    const st = await fs.lstat(path);
    if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOENT' }); // remplacé par un lien ou un dossier
    checkSize(st.size, st.size);
    const v = versionOf(st);
    return {
      etag: etagOf(v.ino, v.size, v.mtimeMs, v.ctimeMs), mtimeMs: v.mtimeMs, size: st.size,
      async stream() {
        const fd = await openReadOnly(path); // sans suivre de lien
        return sniffed(createReadStream(null, { fd, start: 0, end: st.size - 1 }), st.size);
      },
    };
  }

  return {
    /** [{ number, mediaType }] ; le type est celui de l'extension, la réponse de la page donne le vrai. */
    async pages(target) {
      if (target.kind === 'dir') return (await folderImages(target)).map((name, i) => ({ number: i + 1, mediaType: hintFromName(name) }));
      const { pages } = await archives.pages(target.path);
      return pages.map((p, i) => ({ number: i + 1, mediaType: hintFromName(p.name) }));
    },

    /** Source de la page n (à partir de 1), ou null si elle n'existe pas. `pageCount` : seulement pour une archive. */
    async source(target, n) {
      if (target.kind === 'dir') {
        const name = (await folderImages(target))[n - 1];
        return name === undefined ? null : fileSource(join(target.path, name));
      }
      const found = await archives.page(target.path, n);
      if (!found) return null;
      const { page, version: v, stream, count } = found;
      checkSize(page.entry.uncompressedSize, page.entry.compressedSize);
      return {
        pageCount: count, mtimeMs: v.mtimeMs, size: page.entry.uncompressedSize,
        etag: etagOf(v.ino, v.size, v.mtimeMs, v.ctimeMs, page.entry.relativeOffsetOfLocalHeader, page.entry.crc32, page.name),
        async stream() { return sniffed(await stream(), page.entry.uncompressedSize); },
      };
    },

    fileSource,
    clear: () => archives.clear(),
  };
}
