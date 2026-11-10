// Contrat commun des connecteurs : ce que la façade (api.js) attend de chaque
// serveur. Un connecteur est un objet créé par `create({ base })`, où `base`
// est le préfixe de son proxy (« /komga »). Les identifiants qu'il manipule
// sont ceux de son serveur ; la façade se charge de les préfixer.

/**
 * Capacités qu'un connecteur peut déclarer. L'interface ne propose une action
 * que si le serveur concerné l'annonce : on signale ce qui manque, on ne le
 * simule pas.
 */
export const CAP = Object.freeze({
  SERIES_LIST: 'series.list',
  SERIES_SEARCH: 'series.search',
  CHAPTER_LIST: 'chapter.list',
  CHAPTER_READ: 'chapter.read',
  PROGRESS_READ: 'chapter.progress.read',
  PROGRESS_WRITE: 'chapter.progress.write',
  /** Demander au serveur de télécharger des chapitres (méthode `serverDownload`). */
  CHAPTER_DOWNLOAD: 'chapter.download',
  /** Petit stockage clé-valeur côté serveur : abonnements et profils y sont rangés. */
  SETTINGS_STORE: 'settings.store',
});

/** Membres exigés de tout connecteur. */
const ALWAYS = [
  'id', 'code', 'label', 'userLabel', 'capabilities',
  'session', 'login', 'logout',
  'libraries', 'genres',
  'seriesList', 'seriesNew', 'seriesUpdated', 'series', 'seriesBooks',
  'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead',
  'book', 'bookPages', 'nextBook', 'previousBook',
  'seriesThumb', 'bookThumb',
];
/** Membres exigés seulement si la capacité correspondante est déclarée. */
const WHEN = {
  [CAP.PROGRESS_WRITE]: ['saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread'],
  [CAP.CHAPTER_DOWNLOAD]: ['serverDownload'],
  [CAP.SETTINGS_STORE]: ['getSettings', 'setSetting', 'deleteSettings'],
};
const KNOWN = new Set(Object.values(CAP));

/**
 * Vérifie qu'un connecteur respecte le contrat et le renvoie. Appelé une fois
 * au démarrage : une erreur ici signale un connecteur incomplet, pas une panne.
 */
export function validate(connector) {
  const name = connector?.id || '(sans id)';
  const missing = ALWAYS.filter((m) => connector?.[m] === undefined || connector[m] === null);
  const caps = Array.isArray(connector?.capabilities) ? connector.capabilities : [];
  for (const cap of caps) {
    if (!KNOWN.has(cap)) throw new Error(`Connecteur ${name} : capacité inconnue « ${cap} »`);
    missing.push(...(WHEN[cap] || []).filter((m) => typeof connector[m] !== 'function'));
  }
  if (!/^[a-z]$/.test(connector?.code || '')) missing.push('code (une lettre minuscule)');
  if (missing.length) throw new Error(`Connecteur ${name} incomplet : ${missing.join(', ')}`);
  return connector;
}
