// Lecture des archives CBZ/ZIP (READ-002 §4.2, §4.8, §4.10) avec yauzl, seule
// dépendance du service. Rien n'est extrait sur disque et aucune archive n'est
// chargée en mémoire : le répertoire central donne la position de chaque entrée,
// et une page est servie en flux, une seule entrée par requête.
//
// Pour chaque archive ouverte, on garde en mémoire la liste de ses pages et le
// descripteur ouvert. Cette liste est jetée dès qu'un `lstat` montre que l'un de
// ces quatre éléments a changé : inode, taille, date de modification, date de
// changement d'état (ctime). Elle est aussi jetée à chaque parcours complet.
import { open as fsOpen, close as fsClose, fstat, read as fsRead, constants } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { HttpError } from './http.js';
import { compareSegments, isImageName, isIgnoredName } from './naming.js';

export const LIMITS = {
  maxEntries: 5000,                  // entrées du répertoire central
  maxDirectoryBytes: 8 * 1024 * 1024, // taille cumulée des enregistrements du répertoire central
  maxEntryBytes: 64 * 1024 * 1024,   // entrée décompressée (annoncée ; yauzl arrête le flux au-delà)
  ratioFloorBytes: 1024 * 1024,      // en dessous, aucun contrôle du taux de compression
  maxRatio: 200,                     // taille décompressée / taille compressée au-delà de laquelle une entrée est suspecte
  maxNameBytes: 1024,
  maxDepth: 8,                       // niveaux de dossiers dans l'archive
  maxCached: 16,                     // archives gardées ouvertes
};

/** Archive inutilisable : 422 avec un message lisible et sans chemin. `code` sert aux tests. */
export class ArchiveError extends HttpError {
  constructor(code, message) { super(422, message); this.code = code; }
}
const MESSAGES = {
  invalid: 'archive invalid',
  truncated: 'archive truncated or corrupt',
  encrypted: 'archive encrypted',
  unsupported: 'archive uses an unsupported feature (compression method or multi-volume)',
  limit: 'archive exceeds the reading limits',
};
const archiveError = (code) => new ArchiveError(code, MESSAGES[code]);

const openFile = promisify(fsOpen);
const closeFile = promisify(fsClose);
const statFd = promisify(fstat);
const readFd = promisify(fsRead);

/** Ouvre en lecture seule sans suivre un lien symbolique (§4.10). Seul point d'ouverture de fichier du service. */
export const openReadOnly = (path) => openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);

/** Les quatre éléments qui identifient une version d'un fichier. */
export const versionOf = (st) => ({ ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs });
export const sameVersion = (a, b) => a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Erreur de yauzl ou de zlib → ArchiveError. Les erreurs du système de fichiers (EIO, EACCES…) sont relancées telles quelles. */
export function classify(err) {
  if (err instanceof HttpError) return err;
  if (typeof err?.code === 'string' && /^E[A-Z0-9]+$/.test(err.code)) return err;
  const m = String(err?.message);
  if (/encrypt/i.test(m)) return archiveError('encrypted');
  if (/unsupported compression|multi-disk/i.test(m)) return archiveError('unsupported');
  if (/End of central directory|unexpected EOF|overflows file bounds|invalid central directory file header|unexpected end of file|not enough bytes/i.test(m)) return archiveError('truncated');
  return archiveError('invalid');
}

/** Liste des pages d'une archive ouverte : lit le répertoire central, jamais le contenu des entrées. */
async function listPages(zip) {
  if (zip.entryCount > LIMITS.maxEntries) throw archiveError('limit'); // avant toute lecture, ZIP64 compris
  const pages = [];
  const names = new Set();
  let directoryBytes = 0;
  for await (const entry of zip.eachEntry()) {
    directoryBytes += 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
    if (directoryBytes > LIMITS.maxDirectoryBytes) throw archiveError('limit');
    const name = entry.fileName; // yauzl a déjà refusé « .. », les chemins absolus et les lettres de lecteur
    if (/[\x00-\x1f]/.test(name)) throw archiveError('invalid');
    if (entry.fileNameLength > LIMITS.maxNameBytes) throw archiveError('limit');
    if (name.endsWith('/')) continue; // entrée de dossier
    const segments = name.split('/');
    if (segments.length > LIMITS.maxDepth + 1) throw archiveError('limit');
    if (names.has(name)) throw archiveError('invalid'); // deux entrées de même nom : lequel servir ?
    names.add(name);
    if (segments.some(isIgnoredName) || !isImageName(segments.at(-1))) continue; // bruit : __MACOSX, .DS_Store, Thumbs.db, texte…
    if (entry.isEncrypted()) throw archiveError('encrypted');
    if (!entry.canDecodeFileData()) throw archiveError('unsupported');
    pages.push({ name, segments, entry });
  }
  pages.sort((a, b) => compareSegments(a.segments, b.segments));
  return pages;
}

/** Ouvre l'archive, vérifie sa signature et dresse la liste des pages. Ferme le descripteur en cas d'échec. */
async function openArchive(path) {
  const fd = await openReadOnly(path);
  let zip = null;
  try {
    const st = await statFd(fd);
    if (!st.isFile()) throw archiveError('invalid');
    const head = Buffer.alloc(4);
    const { bytesRead } = await readFd(fd, head, 0, 4, 0);
    // « PK\3\4 » (entrée) ou « PK\5\6 » (archive vide) ; sinon ce n'est pas un ZIP.
    if (bytesRead < 4 || head[0] !== 0x50 || head[1] !== 0x4b || !((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6))) throw archiveError('invalid');
    zip = await yauzl.fromFdPromise(fd, { autoClose: false }); // ferme le descripteur à la fermeture de l'archive
    return { version: versionOf(st), zip, pages: await listPages(zip) };
  } catch (e) {
    if (zip) zip.close(); else await closeFile(fd).catch(() => {});
    throw classify(e);
  }
}

export function createArchives() {
  const cache = new Map(); // chemin réel → { version, ready: Promise<{ version, zip, pages }> }

  function drop(path) {
    const hit = cache.get(path);
    if (!hit) return;
    cache.delete(path);
    hit.ready.then(({ zip }) => zip.close(), () => {}); // yauzl ferme le descripteur quand les flux en cours sont terminés
  }

  /** Archive à jour : un `lstat` par requête, relecture si l'une des quatre valeurs a changé. */
  async function get(path) {
    const st = await lstat(path); // ENOENT : le fichier a disparu
    if (!st.isFile()) throw archiveError('invalid');
    const version = versionOf(st);
    const hit = cache.get(path);
    if (hit && sameVersion(hit.version, version)) {
      cache.delete(path); cache.set(path, hit); // le plus récemment utilisé en dernier
      return hit.ready;
    }
    if (hit) drop(path);
    const ready = openArchive(path);
    const record = { version, ready };
    cache.set(path, record);
    ready.then((archive) => { record.version = archive.version; }, (e) => {
      if (!(e instanceof ArchiveError) && cache.get(path) === record) cache.delete(path); // une archive refusée l'est jusqu'à son prochain changement ; une panne disque se réessaie
    });
    while (cache.size > LIMITS.maxCached) drop(cache.keys().next().value);
    return ready;
  }

  return {
    /** Pages (triées) et version de l'archive. */
    async pages(path) {
      const { pages, version } = await get(path);
      return { pages, version };
    },
    /** Page n (à partir de 1) de l'archive : { page, version, stream() }, ou null si elle n'existe pas. `stream` appartient à la même version de l'archive que `page`. */
    async page(path, n) {
      const { pages, version, zip } = await get(path);
      const page = pages[n - 1];
      if (!page) return null;
      const stream = () => zip.openReadStreamPromise(page.entry).catch((e) => {
        // L'archive a été fermée entre-temps (changement détecté par une autre requête) : à réessayer.
        throw e.message === 'closed' ? Object.assign(new Error('archive closed'), { code: 'EAGAIN' }) : classify(e);
      });
      return { page, version, count: pages.length, stream };
    },
    /** Jette toutes les listes (parcours complet, §4.8). */
    clear() { for (const path of [...cache.keys()]) drop(path); },
    get size() { return cache.size; },
  };
}
