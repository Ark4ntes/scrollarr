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
import { CAP, check } from './contract.js';

const ALWAYS = ['id', 'label', 'capabilities', 'serves'];
const OWN_SERVER = ['session', 'login', 'logout'];
const WHEN = {
  [CAP.COLLECT_CHAPTERS]: ['collectChapters'],
  [CAP.COLLECT_TASKS]: ['tasks', 'resolveTasks'],
  [CAP.COLLECT_CANCEL]: ['cancelTask'],
  [CAP.COLLECT_RETRY]: ['retryTask'],
};
const ALLOWED = [CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS, CAP.COLLECT_CANCEL, CAP.COLLECT_RETRY];

/** Vérifie qu'un collecteur respecte le contrat et le renvoie. `readerIds` : lecteurs connus. */
export function validateCollector(collector, readerIds = []) {
  check('Collecteur', collector, { always: typeof collector?.session === 'string' ? ALWAYS : [...ALWAYS, ...OWN_SERVER], when: WHEN, allowed: ALLOWED });
  const name = `Collecteur ${collector.id}`;
  if (!Array.isArray(collector.serves)) throw new Error(`${name} : « serves » doit être une liste`);
  const unknown = [...collector.serves, ...(typeof collector.session === 'string' ? [collector.session] : [])].filter((id) => !readerIds.includes(id));
  if (unknown.length) throw new Error(`${name} : lecteur inconnu « ${unknown.join(', ')} »`);
  for (const cap of [CAP.COLLECT_CANCEL, CAP.COLLECT_RETRY]) {
    if (collector.capabilities.includes(cap) && !collector.capabilities.includes(CAP.COLLECT_TASKS)) throw new Error(`${name} : « ${cap} » demande « collect.tasks »`);
  }
  if (collector.capabilities.includes(CAP.COLLECT_CHAPTERS) && !collector.serves.length) {
    throw new Error(`${name} : « collect.chapters » demande au moins un lecteur dans « serves »`);
  }
  return collector;
}
