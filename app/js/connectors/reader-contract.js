// Contrat d'un lecteur : ce que la façade (api.js) attend d'un serveur dont
// on lit le contenu. Un lecteur est un objet créé par `create({ base })`, où
// `base` est le préfixe de son proxy (« /komga »). Les identifiants qu'il
// manipule sont ceux de son serveur ; la façade se charge de les préfixer.
import { CAP, check } from './contract.js';

const ALWAYS = [
  'id', 'code', 'label', 'userLabel', 'capabilities',
  'session', 'login', 'logout',
  'libraries', 'genres',
  'seriesList', 'seriesNew', 'seriesUpdated', 'series', 'seriesBooks',
  'booksLatest', 'booksOnDeck', 'booksInProgress', 'booksRecentlyRead',
  'book', 'bookPages', 'nextBook', 'previousBook',
  'seriesThumb', 'bookThumb',
];
const WHEN = {
  [CAP.PROGRESS_WRITE]: ['saveProgress', 'markBookRead', 'markBookUnread', 'markSeriesRead', 'markSeriesUnread'],
  [CAP.PROGRESS_PROFILES]: ['setProfile', 'forgetProfile'],
  [CAP.SETTINGS_STORE]: ['getSettings', 'setSetting', 'deleteSettings'],
};
const ALLOWED = [
  CAP.SERIES_LIST, CAP.SERIES_SEARCH, CAP.CHAPTER_LIST, CAP.CHAPTER_READ,
  CAP.PROGRESS_READ, CAP.PROGRESS_WRITE, CAP.PROGRESS_PROFILES, CAP.SETTINGS_STORE,
];

/**
 * Vérifie qu'un lecteur respecte le contrat et le renvoie. Appelé une fois au
 * démarrage : une erreur ici signale un connecteur incomplet, pas une panne.
 */
export function validateReader(reader) {
  check('Lecteur', reader, { always: ALWAYS, when: WHEN, allowed: ALLOWED });
  // Tenir la progression de chaque profil suppose de la lire et de l'écrire.
  if (reader.capabilities.includes(CAP.PROGRESS_PROFILES) && !(reader.capabilities.includes(CAP.PROGRESS_READ) && reader.capabilities.includes(CAP.PROGRESS_WRITE))) {
    throw new Error(`Lecteur ${reader.id} : « ${CAP.PROGRESS_PROFILES} » exige « ${CAP.PROGRESS_READ} » et « ${CAP.PROGRESS_WRITE} »`);
  }
  // Le code sert de préfixe aux identifiants (« s:12.340 ») : une lettre, unique.
  if (!/^[a-z]$/.test(reader.code || '')) throw new Error(`Lecteur ${reader.id} : code attendu sous la forme d'une lettre minuscule`);
  return reader;
}
