// Modèle commun des tâches de collecte. Chaque collecteur a sa propre idée de
// ce qu'est un téléchargement en cours ; ce module ramène tout à une seule
// forme, et garde la mémoire de ce que les collecteurs oublient (heure de
// début, tâches terminées qui disparaissent de leur file d'attente).
//
// Fonctions pures : ni réseau ni navigateur, testées dans tests/unit_tasks.mjs.
//
// Une tâche :
//   id           « collecteur:idNatif », unique dans l'application
//   collector    identifiant du collecteur qui l'exécute
//   nativeId     identifiant de la tâche chez ce collecteur
//   kind         nature du travail (aujourd'hui : « chapter.download »)
//   reader       lecteur auquel se rapportent seriesId et chapterId, ou null
//   seriesId, chapterId       série et chapitre concernés, ou null si inconnus
//   seriesTitle, chapterTitle de quoi l'afficher sans autre requête
//   state        queued | running | done | failed | cancelled
//   progress     de 0 à 1, ou null si le collecteur ne la donne pas
//   createdAt    première fois que l'application a vu la tâche (ms)
//   startedAt    début de l'exécution, ou null
//   finishedAt   fin (réussite, échec ou annulation), ou null
//   error        message d'erreur, ou null
//   attempts     nombre de tentatives déjà faites
//   cancellable  vrai si le collecteur sait annuler cette tâche maintenant
//
// Les dates sont celles que le collecteur fournit. À défaut, c'est le moment
// où l'application a constaté le changement : elles sont alors approximatives.

export const STATE = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', DONE: 'done', FAILED: 'failed', CANCELLED: 'cancelled' });
export const KIND = Object.freeze({ CHAPTER_DOWNLOAD: 'chapter.download' });
const STATES = new Set(Object.values(STATE));
const KINDS = new Set(Object.values(KIND));

export const isActive = (task) => task.state === STATE.QUEUED || task.state === STATE.RUNNING;
export const isFinished = (task) => !isActive(task);
export const taskId = (collectorId, nativeId) => `${collectorId}:${nativeId}`;

const text = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const time = (v) => (Number.isFinite(v) && v > 0 ? v : null);

/**
 * Met au format commun ce qu'un collecteur déclare d'une tâche. Lève une
 * erreur si l'essentiel manque : un collecteur fautif doit se voir tout de suite.
 */
export function normalize(collectorId, raw) {
  const nativeId = text(raw?.nativeId);
  if (!nativeId) throw new Error(`Tâche de ${collectorId} sans identifiant`);
  if (!STATES.has(raw.state)) throw new Error(`Tâche ${collectorId}:${nativeId} : état inconnu « ${raw.state} »`);
  const kind = raw.kind || KIND.CHAPTER_DOWNLOAD;
  if (!KINDS.has(kind)) throw new Error(`Tâche ${collectorId}:${nativeId} : nature inconnue « ${kind} »`);
  const active = raw.state === STATE.QUEUED || raw.state === STATE.RUNNING;
  const progress = raw.state === STATE.DONE ? 1
    : Number.isFinite(raw.progress) ? Math.min(1, Math.max(0, raw.progress)) : null;
  return {
    id: taskId(collectorId, nativeId),
    collector: collectorId,
    nativeId,
    kind,
    reader: text(raw.reader),
    seriesId: text(raw.seriesId),
    chapterId: text(raw.chapterId),
    seriesTitle: text(raw.seriesTitle),
    chapterTitle: text(raw.chapterTitle),
    state: raw.state,
    progress,
    createdAt: time(raw.createdAt),
    startedAt: time(raw.startedAt),
    finishedAt: time(raw.finishedAt),
    error: raw.state === STATE.FAILED ? text(raw.error) : null,
    attempts: Math.max(0, Math.trunc(Number(raw.attempts) || 0)),
    cancellable: active && !!raw.cancellable,
  };
}

/** Applique un nouvel état connu à une tâche déjà suivie (ou à aucune). */
function advance(prev, next, now) {
  // Une tâche terminée qui réapparaît en file d'attente est une nouvelle demande.
  if (prev && isFinished(prev) && isActive(next)) prev = null;
  // Une fois terminée, une tâche ne change plus : un rapport tardif ne la réécrit pas.
  if (prev && isFinished(prev)) return prev;
  const started = next.state !== STATE.QUEUED && next.state !== STATE.CANCELLED;
  return {
    ...next,
    seriesTitle: next.seriesTitle ?? prev?.seriesTitle ?? null,
    chapterTitle: next.chapterTitle ?? prev?.chapterTitle ?? null,
    seriesId: next.seriesId ?? prev?.seriesId ?? null,
    chapterId: next.chapterId ?? prev?.chapterId ?? null,
    reader: next.reader ?? prev?.reader ?? null,
    createdAt: prev?.createdAt ?? next.createdAt ?? now,
    startedAt: next.startedAt ?? prev?.startedAt ?? (started ? now : null),
    finishedAt: isFinished(next) ? next.finishedAt ?? now : null,
    attempts: Math.max(next.attempts, prev?.attempts || 0),
  };
}

/**
 * Fait avancer la liste des tâches suivies à partir de ce qu'un collecteur
 * vient de déclarer.
 *   known     tâches déjà suivies (tous collecteurs confondus)
 *   reports   tâches au format commun (voir normalize) venant d'UN collecteur
 * Les tâches de ce collecteur absentes de `reports` sont laissées telles
 * quelles : c'est à l'appelant de demander au collecteur ce qu'elles sont
 * devenues (voir `missing`) et de repasser la réponse ici.
 */
export function reconcile(known, reports, { now = Date.now(), keep = 60 } = {}) {
  const byId = new Map(known.map((task) => [task.id, task]));
  for (const next of reports) byId.set(next.id, advance(byId.get(next.id), next, now));
  return prune([...byId.values()], keep);
}

/** Tâches actives de ce collecteur dont son dernier rapport ne parle plus. */
export function missing(known, collectorId, reports) {
  const seen = new Set(reports.map((task) => task.id));
  return known.filter((task) => task.collector === collectorId && isActive(task) && !seen.has(task.id));
}

/** Marque une tâche comme annulée (après que le collecteur a accepté l'annulation). */
export function cancelled(known, id, now = Date.now()) {
  return known.map((task) => (task.id === id && isActive(task)
    ? { ...task, state: STATE.CANCELLED, finishedAt: now, cancellable: false, error: null } : task));
}

/** Garde toutes les tâches actives et les `keep` dernières terminées. Les plus récentes d'abord. */
function prune(tasks, keep) {
  const active = tasks.filter(isActive).sort((a, b) => (b.state === STATE.RUNNING) - (a.state === STATE.RUNNING) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const finished = tasks.filter(isFinished).sort((a, b) => b.finishedAt - a.finishedAt || (a.id < b.id ? -1 : 1)).slice(0, keep);
  return [...active, ...finished];
}

// ───────────── Historique partagé entre appareils ─────────────
//
// Chaque appareil garde sa liste de tâches ; les tâches TERMINÉES sont en plus
// recopiées sur les serveurs (document unique, voir api.js). Les tâches
// actives ne sont pas partagées : chaque appareil les reçoit du collecteur
// lui-même, et une tâche active recopiée serait périmée au prochain rapport.
//
// État fusionné : { tasks: [...], cleared: { idTâche: finishedAt } }.
//
// « Effacer l'historique » laisse, pour chaque tâche effacée, une pierre
// tombale `cleared[id] = finishedAt` (et non une date d'effacement : elle
// ne dépend pas de l'horloge de l'appareil qui efface). Une tâche terminée
// est masquée tant que cleared[id] >= son finishedAt ; une nouvelle demande
// (relance) se termine plus tard et réapparaît donc. Les pierres sont bornées.
//
// Choix d'une version par identifiant : chaque version a une date (finishedAt
// pour une tâche terminée, createdAt pour une active) ; la plus récente
// l'emporte, et à date égale la terminée l'emporte sur l'active. Ainsi une
// terminée bat une active plus ancienne (rapport tardif), mais une active créée
// après la fin est une nouvelle demande et l'emporte. Les égalités restantes
// sont départagées par un ordre fixe : le résultat ne dépend pas de l'ordre
// des arguments, et fusionner deux fois donne la même chose.

const when = (task) => (isFinished(task) ? task.finishedAt : task.createdAt) || 0;
const text2 = (v) => (v === null || v === undefined ? '' : String(v));
function compareVersion(x, y) {
  return when(x) - when(y)
    || isFinished(x) - isFinished(y)
    || (x.attempts || 0) - (y.attempts || 0)
    || (text2(x.state) === text2(y.state) ? 0 : text2(x.state) > text2(y.state) ? 1 : -1)
    || (JSON.stringify(x) === JSON.stringify(y) ? 0 : JSON.stringify(x) > JSON.stringify(y) ? 1 : -1);
}
const valid = (task) => task && typeof task.id === 'string' && task.id && STATES.has(task.state);

/**
 * Fusionne deux états. Chaque argument est soit l'ancien format (un simple
 * tableau de tâches, sans pierres tombales), soit { tasks, cleared }.
 * `keep` tâches terminées au plus, `keepCleared` pierres tombales au plus.
 */
export function mergeTasks(a, b, { keep = 60, keepCleared = 200 } = {}) {
  const parts = [a, b].map((x) => (Array.isArray(x) ? { tasks: x, cleared: {} } : x || {}));
  const cleared = {};
  for (const p of parts) {
    for (const [id, at] of Object.entries(p.cleared && typeof p.cleared === 'object' ? p.cleared : {})) {
      if (Number.isFinite(at) && at > (cleared[id] ?? -1)) cleared[id] = at;
    }
  }
  const byId = new Map();
  for (const p of parts) {
    for (const task of Array.isArray(p.tasks) ? p.tasks : []) {
      if (valid(task) && (!byId.has(task.id) || compareVersion(task, byId.get(task.id)) > 0)) byId.set(task.id, task);
    }
  }
  const visible = [...byId.values()].filter((task) => !(isFinished(task) && cleared[task.id] >= (task.finishedAt || 0)));
  const tombstones = Object.entries(cleared).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, keepCleared);
  return { tasks: prune(visible, keep), cleared: Object.fromEntries(tombstones) };
}

/**
 * Ce qui est recopié sur les serveurs : les tâches terminées seulement, dans
 * un ordre fixe (le même document sur tous les appareils, donc pas d'écriture
 * inutile quand rien n'a changé).
 */
export function sharedView(state, opts) {
  const m = mergeTasks(state, null, opts);
  const tasks = m.tasks.filter(isFinished).sort((x, y) => y.finishedAt - x.finishedAt || (x.id < y.id ? -1 : 1));
  const cleared = Object.fromEntries(Object.entries(m.cleared).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  return { v: 1, tasks, cleared };
}
