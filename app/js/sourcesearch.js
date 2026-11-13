// Recherche chez les sources : quelles sources interroger, et comment les parcourir.
// Fonctions sans réseau ni écran (hors le stockage de l'appareil), testées dans tests/unit_collect.mjs.

/** Nombre de sources interrogées en même temps : chaque recherche fait travailler un site tiers et le serveur. */
export const CONCURRENCY = 3;
const KEY = 'scrollarr.searchSources';
const MULTI = ['all', 'multi'];

const nameOf = (code) => String(code || '').toLowerCase().split('-')[0];

/**
 * Sources cochées tant que l'utilisateur n'a rien choisi : celles qui ne sont pas signalées « adultes » par le
 * serveur, dans la langue de l'interface ou multilingues. Si aucune ne convient (un serveur d'extensions
 * anglaises avec une interface en français), toutes les non adultes : mieux vaut chercher que ne rien proposer.
 * Une source « adulte » n'est jamais cochée d'office.
 */
export function defaultSelection(sources, lang) {
  const safe = sources.filter((s) => !s.nsfw);
  const mine = safe.filter((s) => MULTI.includes(String(s.language).toLowerCase()) || nameOf(s.language) === nameOf(lang));
  return (mine.length ? mine : safe).map((s) => s.id);
}

/** Identifiants à interroger : le choix mémorisé (restreint aux sources qui existent encore), sinon la sélection par défaut. */
export function selectedIds(sources, saved, lang) {
  if (!Array.isArray(saved)) return defaultSelection(sources, lang);
  const have = new Set(saved);
  return sources.filter((s) => have.has(s.id)).map((s) => s.id);
}

/** Choix mémorisé pour ce collecteur, ou null si l'utilisateur n'a rien choisi. */
export function loadSaved(collectorId) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(all?.[collectorId]) ? all[collectorId].map(String) : null;
  } catch { return null; }
}
export function saveSelection(collectorId, ids) {
  try {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* mémoire illisible : on repart de zéro */ }
    localStorage.setItem(KEY, JSON.stringify({ ...all, [collectorId]: ids.map(String) }));
  } catch { /* stockage refusé : le choix vaut pour cet écran seulement */ }
}
export function forgetSelection(collectorId) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) || {};
    delete all[collectorId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* rien à oublier */ }
}

/** « FR », « EN », ou le texte donné pour « plusieurs langues ». */
export function languageLabel(code, multiLabel) {
  if (!code) return '';
  return MULTI.includes(String(code).toLowerCase()) ? multiLabel : String(code).toUpperCase();
}

/**
 * Interroge les sources avec un nombre limité de recherches en parallèle. L'échec d'une source est rendu à
 * `onSource` et n'arrête pas les autres. `stopWhen(error)` : si vrai (le serveur lui-même est injoignable),
 * les sources qui n'ont pas démarré ne sont pas cherchées et sont signalées « skipped ».
 * `cancelled()` : l'écran n'est plus là, on ne lance plus rien et on ne rend plus rien.
 *
 *   onStart(source)                  une recherche commence
 *   onSource(source, outcome)        outcome = { ok: true, ...réponse } | { ok: false, error } | { ok: false, skipped: true }
 */
export async function searchEach(sources, query, searchOne, { concurrency = CONCURRENCY, cancelled = () => false, stopWhen = () => false, onStart = () => {}, onSource = () => {} } = {}) {
  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < sources.length && !cancelled()) {
      const source = sources[next++];
      if (stopped) { onSource(source, { ok: false, skipped: true }); continue; }
      onStart(source);
      let outcome;
      try { outcome = { ok: true, ...(await searchOne(source, query)) }; }
      catch (error) { outcome = { ok: false, error }; if (stopWhen(error)) stopped = true; }
      if (cancelled()) return;
      onSource(source, outcome);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
}
