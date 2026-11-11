// Conventions de nommage (READ-002 §4.1) : noms ignorés, types de fichiers,
// tri naturel, numéro de chapitre. Aucune entrée/sortie ici : fonctions pures.

const IGNORED = new Set(['@eadir', '#recycle', 'thumbs.db', '__macosx']);
export const isIgnoredName = (name) => name.startsWith('.') || IGNORED.has(name.toLowerCase());

const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
const ARCHIVE = /\.(cbz|zip)$/i;
const COVER = /^cover\.(jpe?g|png|webp)$/i;
export const isImageName = (name) => IMAGE.test(name);
export const isArchiveName = (name) => ARCHIVE.test(name);
export const isCoverName = (name) => COVER.test(name);

/** Nom d'affichage : Unicode NFC, espaces de bord retirés. */
export const displayName = (name) => name.normalize('NFC').trim();
export const stripExtension = (name) => name.replace(ARCHIVE, '');

// ── Tri naturel ──
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const LABELS = /^(?:\s*\[[^\]]*\])+\s*/;
/** Retire les étiquettes entre crochets en tête (« [Équipe] 002 » se trie comme « 002 »). */
export const stripLabels = (name) => name.replace(LABELS, '') || name;

/** Compare deux listes de segments de chemin, segment par segment. */
export function compareSegments(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = collator.compare(stripLabels(a[i]), stripLabels(b[i]));
    if (c) return c;
  }
  if (a.length !== b.length) return a.length - b.length;
  // Égalité naturelle (casse, accents) : ordre stable sur les noms bruts.
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export const compareNames = (a, b) => compareSegments([a], [b]);

// ── Numéro de chapitre ──
const MARKER = /(?:^|[^\p{L}\p{N}])(?:chapitre|chapter|chap|ch|ep|c)\.?[\s_-]*(\d+(?:[.,]\d+)?)|#\s*(\d+(?:[.,]\d+)?)/giu;
const NUMBER = /\d+(?:[.,]\d+)?/g;
const toNumber = (s) => Number(s.replace(',', '.'));

/**
 * Numéro déduit du nom : marqueur explicite (ch, chap, chapitre, chapter, c, ep, #)
 * suivi d'un nombre, sinon dernier nombre du nom. Parenthèses, crochets et titre
 * de la série sont écartés d'abord. Renvoie null s'il n'y en a pas.
 */
export function detectNumber(name, seriesTitle = '') {
  let s = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  if (seriesTitle) s = s.replace(new RegExp(escapeRe(seriesTitle), 'giu'), ' ');
  const marked = [...s.matchAll(MARKER)];
  if (marked.length) { const m = marked[marked.length - 1]; return toNumber(m[1] ?? m[2]); }
  const all = s.match(NUMBER);
  return all ? toNumber(all[all.length - 1]) : null;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ordre de tri exposé à l'application (`numberSort`) : les numéros détectés si
 * tous existent et croissent strictement dans l'ordre de lecture, sinon le rang 1…n.
 * `numbers` est dans l'ordre de lecture.
 */
export function numberSorts(numbers) {
  const usable = numbers.every((n, i) => n !== null && (i === 0 || n > numbers[i - 1]));
  return numbers.map((n, i) => (usable ? n : i + 1));
}

/** Clé de recherche : minuscules, sans accents. */
export const searchKey = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
