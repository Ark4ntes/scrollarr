// Ce que tous les connecteurs ont en commun, quel que soit leur rôle.
//
// Scrollarr distingue deux rôles, décrits chacun par son propre contrat :
//  - un LECTEUR (reader-contract.js) fournit des séries, des chapitres, des
//    pages et une progression : c'est ce qu'on lit ;
//  - un COLLECTEUR (collector-contract.js) va chercher des chapitres pour les
//    mettre à disposition d'un lecteur : c'est ce qui alimente la bibliothèque.
// Un même logiciel peut tenir les deux rôles (Suwayomi) : il a alors deux
// modules, un dans readers/ et un dans collectors/, qui ne se connaissent pas.

/**
 * Capacités qu'un connecteur peut déclarer. L'interface ne propose une action
 * que si un connecteur l'annonce : on signale ce qui manque, on ne le simule pas.
 */
export const CAP = Object.freeze({
  // ── Lecteurs ──
  SERIES_LIST: 'series.list',
  SERIES_SEARCH: 'series.search',
  CHAPTER_LIST: 'chapter.list',
  CHAPTER_READ: 'chapter.read',
  PROGRESS_READ: 'chapter.progress.read',
  PROGRESS_WRITE: 'chapter.progress.write',
  /**
   * Le serveur tient lui-même la progression de chaque profil (méthodes `setProfile` et `forgetProfile`) : la façade
   * lui indique le profil actif et ne lui applique pas la surcouche des profils secondaires. Exige les deux capacités de progression.
   */
  PROGRESS_PROFILES: 'chapter.progress.profiles',
  /** Petit stockage clé-valeur côté serveur : abonnements et profils y sont rangés. */
  SETTINGS_STORE: 'settings.store',
  // ── Collecteurs ──
  /** Récupérer des chapitres déjà connus d'un lecteur (méthode `collectChapters`). */
  COLLECT_CHAPTERS: 'collect.chapters',
  /** Déclarer ses tâches en cours, au format de tasks.js (méthodes `tasks` et `resolveTasks`). */
  COLLECT_TASKS: 'collect.tasks',
  /** Annuler une tâche (méthode `cancelTask`). */
  COLLECT_CANCEL: 'collect.cancel',
  /** Relancer une tâche en échec ou annulée (méthode `retryTask`). */
  COLLECT_RETRY: 'collect.retry',
  /** Dire où il sait chercher : ses « sources » (méthode `sources`). */
  COLLECT_SOURCES: 'collect.sources',
  /** Chercher une série par son titre dans l'une de ces sources (méthode `search`). Exige `collect.sources`. */
  COLLECT_SEARCH: 'collect.search',
  /** Ajouter ou suivre un résultat de recherche (méthode `add`). Exige `collect.search`. */
  COLLECT_ADD: 'collect.add',
});

/**
 * Vérification partagée par les deux contrats.
 *  - always : membres exigés de tout connecteur de ce rôle ;
 *  - when   : membres exigés seulement si la capacité est déclarée ;
 *  - allowed: capacités que ce rôle a le droit de déclarer.
 */
export function check(role, connector, { always, when, allowed }) {
  const name = `${role} ${connector?.id || '(sans id)'}`;
  const missing = always.filter((m) => connector?.[m] === undefined || connector[m] === null);
  const caps = Array.isArray(connector?.capabilities) ? connector.capabilities : [];
  for (const cap of caps) {
    if (!allowed.includes(cap)) throw new Error(`${name} : capacité « ${cap} » inconnue pour ce rôle`);
    missing.push(...(when[cap] || []).filter((m) => typeof connector[m] !== 'function'));
  }
  if (missing.length) throw new Error(`${name} incomplet : ${missing.join(', ')}`);
  return connector;
}
