// Contrat d'un collecteur : un outil qui va chercher des chapitres. Il ne
// sait pas forcément lister une bibliothèque ni servir des pages, et on ne le
// lui demande pas : c'est le rôle des lecteurs.
//
// Un collecteur est un objet créé par `create({ base })`.
//
//   id, label      identifiant et nom affiché
//   capabilities   ce qu'il sait faire, parmi les capacités « Collecteurs » de contract.js
//   serves         identifiants des lecteurs dont il comprend les identifiants de chapitre.
//                  Suwayomi-collecteur sert Suwayomi-lecteur : on peut lui désigner un
//                  chapitre affiché à l'écran. Un collecteur qui ne partage ses identifiants
//                  avec aucun lecteur déclare une liste vide.
//   session        (facultatif) nom du lecteur dont il réutilise la session. Sans cela, le
//                  collecteur a son propre serveur et fournit session(), login(), logout(),
//                  comme un lecteur.
//
// Selon les capacités déclarées :
//   collect.chapters → collectChapters(readerId, chapterIds)
//                      demande la récupération de chapitres désignés par les identifiants
//                      du lecteur `readerId` (qui figure dans `serves`).
//   collect.tasks    → tasks()
//                      renvoie les tâches que le collecteur connaît en ce moment. Chacune
//                      est un objet { nativeId, state, progress, attempts, error, cancellable,
//                      reader, seriesId, chapterId, seriesTitle, chapterTitle, startedAt,
//                      finishedAt } ; voir tasks.js pour le sens de chaque champ. Les
//                      identifiants de série et de chapitre sont ceux du lecteur `reader`.
//                    → resolveTasks(nativeIds)
//                      dit ce que sont devenues des tâches que tasks() ne renvoie plus
//                      (terminées, annulées ailleurs…), sous la même forme. Un collecteur
//                      qui garde son historique peut renvoyer une liste vide.
//   collect.cancel   → cancelTask(nativeId)
//   collect.retry    → retryTask(nativeId)
//                      relance une tâche en échec ou annulée ; elle réapparaît ensuite dans tasks().
//
// Partir d'un titre plutôt que d'un chapitre connu d'un lecteur (trois capacités, chacune exige la précédente) :
//   collect.sources  → sources()
//                      renvoie la liste des endroits où il sait chercher : [Source].
//   collect.search   → search(sourceId, query)
//                      cherche `query` dans une seule source et renvoie { results: [Résultat], more }.
//                      Une recherche interroge des sites tiers : l'application ne la lance que sur une
//                      action explicite de l'utilisateur. Elle interroge les sources une par une, avec un
//                      parallélisme borné, et traite l'échec d'une source sans toucher aux autres : search()
//                      lève une erreur pour cette source seule, qui ne doit pas rendre le collecteur
//                      inutilisable ni invalider sa session. Une source lente ne doit pas non plus faire
//                      passer le serveur pour injoignable (voir `isolated` dans net.js).
//   collect.add      → add(resultId)
//                      ajoute ou suit un résultat pour qu'il devienne une série du lecteur qu'il sert.
//                      Renvoie { reader, seriesId, complete }.
//
// Source : { id, label, language, nsfw, icon }
//   id        identifiant natif, texte non vide, propre à ce collecteur
//   label     nom affiché
//   language  code de langue tel que le serveur le donne (« fr », « en », « all » pour plusieurs), ou null
//   nsfw      vrai si le serveur signale la source comme réservée aux adultes. Le collecteur reprend
//             l'indication du serveur, il n'en invente pas ; c'est l'application qui décide de ne pas
//             la chercher par défaut.
//   icon      URL de l'icône, ou null
//
// Résultat : { id, title, cover, sourceId, sourceLabel, language, inLibrary, reader, seriesId }
//   id            identifiant natif du résultat chez ce collecteur ; opaque pour l'application, qui le
//                 rend tel quel à add(). Unique dans le collecteur, toutes sources confondues.
//   title         titre tel que la source le donne
//   cover         couverture, ou null. Chemin absolu de même origine (« /suwayomi/... »), donc passant par
//                 le proxy de l'application : la politique de sécurité n'autorise aucune image externe.
//   sourceId, sourceLabel, language   la source qui l'a renvoyé (mêmes valeurs que dans sources())
//   inLibrary     vrai si le collecteur le tient déjà : série ajoutée (Suwayomi) ou suivie (Tranga…)
//   reader, seriesId
//                 la série correspondante chez le lecteur. Les deux sont renseignés ensemble, jamais
//                 seulement l'un des deux, et seulement si inLibrary. `reader` est l'un des lecteurs de
//                 `serves`, `seriesId` son identifiant brut (la façade y met son préfixe).
//                 Un collecteur qui ne partage aucun identifiant avec un lecteur (Tranga, Mangarr) met
//                 toujours null dans les deux : il peut dire inLibrary: true (« déjà suivi »), mais la série
//                 n'existe chez un lecteur qu'une fois ses fichiers récupérés et scannés (COL-007), et on ne
//                 sait pas laquelle c'est avant. L'application n'y propose alors aucun lien.
//
// Réponse de search : { results: [Résultat], more }
//   more      vrai si la source a d'autres résultats que ceux renvoyés (une seule page est demandée)
//
// Réponse de add : { reader, seriesId, complete }
//   reader, seriesId   comme pour un résultat : la série qui existe désormais chez le lecteur, ou null et null
//                      pour un collecteur sans identifiants communs, où il n'y a encore rien à ouvrir
//   complete           faux si la série est bien ajoutée mais que sa liste de chapitres n'a pas pu être
//                      récupérée (le collecteur peut la compléter plus tard de lui-même)
// add() lève une erreur si l'ajout lui-même a échoué. Il ne met rien en file d'attente hors ligne.
import { CAP, check } from './contract.js';

const ALWAYS = ['id', 'label', 'capabilities', 'serves'];
const OWN_SERVER = ['session', 'login', 'logout'];
const WHEN = {
  [CAP.COLLECT_CHAPTERS]: ['collectChapters'],
  [CAP.COLLECT_TASKS]: ['tasks', 'resolveTasks'],
  [CAP.COLLECT_CANCEL]: ['cancelTask'],
  [CAP.COLLECT_RETRY]: ['retryTask'],
  [CAP.COLLECT_SOURCES]: ['sources'],
  [CAP.COLLECT_SEARCH]: ['search'],
  [CAP.COLLECT_ADD]: ['add'],
};
const ALLOWED = [CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS, CAP.COLLECT_CANCEL, CAP.COLLECT_RETRY, CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH, CAP.COLLECT_ADD];
// Chaque capacité de la liste exige la précédente.
const NEEDS = [
  [CAP.COLLECT_CANCEL, CAP.COLLECT_TASKS],
  [CAP.COLLECT_RETRY, CAP.COLLECT_TASKS],
  [CAP.COLLECT_SEARCH, CAP.COLLECT_SOURCES],
  [CAP.COLLECT_ADD, CAP.COLLECT_SEARCH],
];

/** Vérifie qu'un collecteur respecte le contrat et le renvoie. `readerIds` : lecteurs connus. */
export function validateCollector(collector, readerIds = []) {
  check('Collecteur', collector, { always: typeof collector?.session === 'string' ? ALWAYS : [...ALWAYS, ...OWN_SERVER], when: WHEN, allowed: ALLOWED });
  const name = `Collecteur ${collector.id}`;
  if (!Array.isArray(collector.serves)) throw new Error(`${name} : « serves » doit être une liste`);
  const unknown = [...collector.serves, ...(typeof collector.session === 'string' ? [collector.session] : [])].filter((id) => !readerIds.includes(id));
  if (unknown.length) throw new Error(`${name} : lecteur inconnu « ${unknown.join(', ')} »`);
  for (const [cap, needed] of NEEDS) {
    if (collector.capabilities.includes(cap) && !collector.capabilities.includes(needed)) throw new Error(`${name} : « ${cap} » demande « ${needed} »`);
  }
  if (collector.capabilities.includes(CAP.COLLECT_CHAPTERS) && !collector.serves.length) {
    throw new Error(`${name} : « collect.chapters » demande au moins un lecteur dans « serves »`);
  }
  return collector;
}

// ───────────── Formes échangées avec l'application ─────────────
// Chaque fonction vérifie ce qu'un collecteur a renvoyé et le renvoie sous sa forme normalisée (champs
// facultatifs mis à null). Elles servent à la façade, qui refuse une réponse mal formée plutôt que de
// l'afficher, et aux tests du contrat.

const bad = (collector, what, why) => new Error(`Collecteur ${collector?.id || '(sans id)'} : ${what} invalide, ${why}`);
const text = (v) => typeof v === 'string' && v.length > 0;
const orNull = (v) => (v === undefined ? null : v);
/** Chemin absolu de même origine : le seul genre d'image que la politique de sécurité de l'application accepte. */
export const isSameOriginPath = (v) => typeof v === 'string' && /^\/(?!\/)/.test(v);

export function normalizeSource(collector, source) {
  if (!source || typeof source !== 'object') throw bad(collector, 'source', 'objet attendu');
  if (!text(source.id)) throw bad(collector, 'source', '« id » doit être un texte non vide');
  if (!text(source.label)) throw bad(collector, `source ${source.id}`, '« label » doit être un texte non vide');
  const language = orNull(source.language);
  if (language !== null && typeof language !== 'string') throw bad(collector, `source ${source.id}`, '« language » doit être un texte ou null');
  if (typeof source.nsfw !== 'boolean') throw bad(collector, `source ${source.id}`, '« nsfw » doit être un booléen');
  const icon = orNull(source.icon);
  if (icon !== null && !isSameOriginPath(icon)) throw bad(collector, `source ${source.id}`, '« icon » doit être un chemin de même origine ou null');
  return { id: source.id, label: source.label, language, nsfw: source.nsfw, icon };
}

/** Série d'un lecteur désignée par (reader, seriesId) : les deux ensemble, et seulement chez un lecteur servi. */
function checkTarget(collector, what, { reader, seriesId }) {
  if (reader === null && seriesId === null) return;
  if (!text(reader) || !text(seriesId)) throw bad(collector, what, '« reader » et « seriesId » vont ensemble : tous deux renseignés, ou tous deux null');
  if (!collector.serves.includes(reader)) throw bad(collector, what, `le lecteur « ${reader} » ne figure pas dans « serves »`);
}

export function normalizeResult(collector, result) {
  if (!result || typeof result !== 'object') throw bad(collector, 'résultat', 'objet attendu');
  const what = `résultat ${result.id}`;
  if (!text(result.id)) throw bad(collector, 'résultat', '« id » doit être un texte non vide');
  if (!text(result.title)) throw bad(collector, what, '« title » doit être un texte non vide');
  const cover = orNull(result.cover);
  if (cover !== null && !isSameOriginPath(cover)) throw bad(collector, what, '« cover » doit être un chemin de même origine ou null');
  if (!text(result.sourceId)) throw bad(collector, what, '« sourceId » doit être un texte non vide');
  if (typeof result.sourceLabel !== 'string') throw bad(collector, what, '« sourceLabel » doit être un texte');
  const language = orNull(result.language);
  if (language !== null && typeof language !== 'string') throw bad(collector, what, '« language » doit être un texte ou null');
  if (typeof result.inLibrary !== 'boolean') throw bad(collector, what, '« inLibrary » doit être un booléen');
  const target = { reader: orNull(result.reader), seriesId: orNull(result.seriesId) };
  checkTarget(collector, what, target);
  if (target.seriesId !== null && !result.inLibrary) throw bad(collector, what, 'une série de lecteur suppose « inLibrary »');
  return { id: result.id, title: result.title, cover, sourceId: result.sourceId, sourceLabel: result.sourceLabel, language, inLibrary: result.inLibrary, ...target };
}

export function normalizeSearch(collector, response) {
  if (!response || !Array.isArray(response.results)) throw bad(collector, 'réponse de recherche', '« results » doit être une liste');
  return { results: response.results.map((r) => normalizeResult(collector, r)), more: response.more === true };
}

export function normalizeAdded(collector, added) {
  if (!added || typeof added !== 'object') throw bad(collector, 'réponse d’ajout', 'objet attendu');
  const target = { reader: orNull(added.reader), seriesId: orNull(added.seriesId) };
  checkTarget(collector, 'réponse d’ajout', target);
  if (typeof added.complete !== 'boolean') throw bad(collector, 'réponse d’ajout', '« complete » doit être un booléen');
  return { ...target, complete: added.complete };
}
