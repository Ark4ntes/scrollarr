// Identifiants opaques et résolution identifiant → chemin (READ-002 §4.7).
// C'est le SEUL module qui connaît à la fois les identifiants et les chemins :
// le reste du service (routes, progression, pages) ne manipule que des
// identifiants. Aucun chemin ne sort de ce module vers l'API.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';

const hex16 = (text) => createHash('sha256').update(text.normalize('NFC')).digest('hex').slice(0, 16);

// Minuscules et chiffres seulement : les identifiants de série sont mis en minuscules ailleurs.
export const libraryId = (library) => hex16(`bibliotheque\0${library}`);
export const seriesId = (library, rel) => hex16(`${library}\0${rel}`);
export const bookId = (library, seriesRel, rel) => `${seriesId(library, seriesRel)}.${hex16(`${library}\0${rel}`)}`;

const SERIES = /^[0-9a-f]{16}$/;
const BOOK = /^[0-9a-f]{16}\.[0-9a-f]{16}$/;
export const isSeriesId = (id) => typeof id === 'string' && SERIES.test(id);
export const isBookId = (id) => typeof id === 'string' && BOOK.test(id);
export const seriesOfBook = (id) => id.slice(0, 16);

/** Table identifiant → { library, rel } ; `rel` est le chemin relatif à la racine de la bibliothèque. */
export function createRegistry() {
  const map = new Map();
  return {
    add(id, library, rel) { map.set(id, { library, rel }); },
    locate(id) { return map.get(id) || null; },
    remove(id) { map.delete(id); },
    has: (id) => map.has(id),
    get size() { return map.size; },
  };
}

export class ConfinementError extends Error {}

/**
 * Chemin réel d'une entrée de bibliothèque, ou ConfinementError. Refuse : chemin
 * absolu, `..`, segments vides, octet nul, et tout chemin dont une composante est
 * un lien symbolique (les liens ne sont jamais suivis). Une absence est signalée
 * par l'erreur ENOENT du système, que l'appelant traduit en « disparu ».
 */
export async function confine(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0') || isAbsolute(rel)) throw new ConfinementError('chemin refusé');
  if (rel !== '' && rel.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new ConfinementError('chemin refusé');
  const realRoot = await fs.realpath(root);
  const target = rel === '' ? realRoot : join(realRoot, rel);
  const real = await fs.realpath(target);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new ConfinementError('hors de la bibliothèque');
  if (real !== target) throw new ConfinementError('lien symbolique non suivi');
  return real;
}

/** Comme confine, avec en plus : fichier ordinaire (pas un lien, pas un dossier). */
export async function confineFile(root, rel) {
  const real = await confine(root, rel);
  const st = await fs.lstat(real);
  if (!st.isFile()) throw new ConfinementError('fichier ordinaire attendu');
  return real;
}

/** Résolution complète : identifiant → chemin réel confiné, ou null si l'identifiant est inconnu. */
export async function resolve(registry, roots, id) {
  const loc = registry.locate(id);
  if (!loc || !roots.has(loc.library)) return null;
  return confine(roots.get(loc.library), loc.rel);
}
