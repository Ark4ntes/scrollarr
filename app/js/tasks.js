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
//   autoRetries  relances automatiques déjà faites par Scrollarr (distinct de `attempts`,
//                qui compte les essais internes du collecteur) ; une relance manuelle le remet à 0
//   nextRetryAt  heure de la prochaine relance automatique d'une tâche en échec, ou null
//                (annulée, épuisée, ou échec antérieur à cette fonction)
//   claimBy, claimUntil   appareil qui s'apprête à relancer, jusqu'à quand (voir « Relance automatique »)
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
    autoRetries: 0,
    nextRetryAt: null,
    claimBy: null,
    claimUntil: null,
  };
}

/** Applique un nouvel état connu à une tâche déjà suivie (ou à aucune). */
function advance(prev, next, now, retry) {
  // Une tâche terminée qui réapparaît en file d'attente est une nouvelle demande. Si c'est une
  // relance d'un échec, le compte des relances automatiques se poursuit (une relance manuelle l'a remis à 0).
  let carried = 0;
  if (prev && isFinished(prev) && isActive(next)) { carried = prev.state === STATE.FAILED ? prev.autoRetries || 0 : 0; prev = null; }
  // Une fois terminée, une tâche ne change plus : un rapport tardif ne la réécrit pas.
  if (prev && isFinished(prev)) return prev;
  const started = next.state !== STATE.QUEUED && next.state !== STATE.CANCELLED;
  const autoRetries = prev ? prev.autoRetries || 0 : carried;
  const finishedAt = isFinished(next) ? next.finishedAt ?? now : null;
  const delay = next.state === STATE.FAILED ? retryDelay(autoRetries, retry) : null;
  return {
    ...next,
    seriesTitle: next.seriesTitle ?? prev?.seriesTitle ?? null,
    chapterTitle: next.chapterTitle ?? prev?.chapterTitle ?? null,
    seriesId: next.seriesId ?? prev?.seriesId ?? null,
    chapterId: next.chapterId ?? prev?.chapterId ?? null,
    reader: next.reader ?? prev?.reader ?? null,
    createdAt: prev?.createdAt ?? next.createdAt ?? now,
    startedAt: next.startedAt ?? prev?.startedAt ?? (started ? now : null),
    finishedAt,
    attempts: Math.max(next.attempts, prev?.attempts || 0),
    autoRetries,
    nextRetryAt: delay === null ? null : finishedAt + delay,
    claimBy: null,
    claimUntil: null,
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
export function reconcile(known, reports, { now = Date.now(), keep = 60, retry } = {}) {
  const byId = new Map(known.map((task) => [task.id, task]));
  for (const next of reports) byId.set(next.id, advance(byId.get(next.id), next, now, retry));
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

// ───────────── Relance automatique ─────────────
//
// Scrollarr n'a pas de serveur : une relance ne part que si l'application est
// ouverte sur un appareil (voir refreshTasks dans api.js). La politique, elle,
// est pure : étant donné une tâche en échec et l'heure, que faire ?
//
// Délais croissants entre deux relances, puis on s'arrête : le collecteur a
// déjà fait ses propres essais, insister sans fin ne ferait que charger la
// source. 1 min, 5 min, 30 min : trois relances au plus.

export const RETRY = Object.freeze({
  delays: Object.freeze([60000, 300000, 1800000]), // délai avant la relance n°1, n°2, n°3
  jitterMs: 10000,  // décalage propre à chaque appareil, voir retryJitter
  claimMs: 120000,  // durée pendant laquelle un appareil « tient » une relance
  maxPerPass: 3,    // relances envoyées au plus par passage de refreshTasks
});

/** Délai avant la prochaine relance automatique, ou null si elles sont épuisées. */
export function retryDelay(autoRetries, opts = RETRY) {
  const delays = (opts || RETRY).delays;
  return autoRetries >= 0 && autoRetries < delays.length ? delays[autoRetries] : null;
}

/** Décalage stable (0 à jitterMs) tiré de l'identifiant de l'appareil : deux appareils ouverts ne se réveillent pas ensemble. */
export function retryJitter(device, opts = RETRY) {
  const max = (opts || RETRY).jitterMs;
  let h = 0;
  for (const ch of String(device || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return max > 0 ? h % max : 0;
}

/**
 * Où en est la relance automatique d'une tâche, pour cet appareil.
 *   status  'none'       rien à faire ni à dire (pas en échec, annulée, collecteur sans relance, ancien échec)
 *           'scheduled'  relance prévue à `at`
 *           'due'        à relancer maintenant
 *           'claimed'    un autre appareil s'en occupe jusqu'à `at`
 *           'exhausted'  le maximum de relances automatiques est atteint
 */
export function retryPlan(task, { now = Date.now(), canRetry = true, device = '', opts = RETRY } = {}) {
  if (task.state !== STATE.FAILED || !canRetry) return { status: 'none', at: null };
  if ((task.autoRetries || 0) >= (opts || RETRY).delays.length) return { status: 'exhausted', at: null };
  if (!Number.isFinite(task.nextRetryAt)) return { status: 'none', at: null };
  if (task.claimBy && task.claimBy !== device && task.claimUntil > now) return { status: 'claimed', at: task.claimUntil };
  const at = task.nextRetryAt + retryJitter(device, opts);
  return { status: now >= at ? 'due' : 'scheduled', at };
}

/**
 * Deux appareils ouverts ne doivent pas relancer la même tâche. Le stockage des
 * serveurs n'offre pas de comparaison atomique : on combine donc (1) un
 * décalage propre à chaque appareil (retryJitter), (2) une « réservation »
 * écrite dans la tâche partagée avant d'envoyer la relance, que l'appareil
 * relit ensuite pour vérifier qu'elle est bien la sienne (la plus longue puis
 * le plus grand identifiant l'emporte, voir compareVersion), et (3) la
 * relance elle-même, partagée tant qu'elle est en cours. Ce n'est pas
 * infaillible (deux écritures simultanées peuvent se croiser), mais une
 * relance en double ne coûte qu'un redémarrage du téléchargement.
 */
export function claimed(known, id, device, { now = Date.now(), opts = RETRY } = {}) {
  return known.map((task) => (task.id === id && task.state === STATE.FAILED
    ? { ...task, claimBy: device, claimUntil: now + (opts || RETRY).claimMs } : task));
}

/** Après l'envoi d'une relance : automatique (compte une relance de plus) ou manuelle (remet le compte à 0). */
export function retried(known, id, { auto }) {
  return known.map((task) => (task.id === id && task.state === STATE.FAILED
    ? { ...task, autoRetries: auto ? (task.autoRetries || 0) + 1 : 0, nextRetryAt: null, claimBy: null, claimUntil: null } : task));
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
    || (x.autoRetries || 0) - (y.autoRetries || 0)
    || (x.claimUntil || 0) - (y.claimUntil || 0)
    || (text2(x.claimBy) === text2(y.claimBy) ? 0 : text2(x.claimBy) > text2(y.claimBy) ? 1 : -1)
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
 * Ce qui est recopié sur les serveurs : les tâches terminées, plus les
 * relances automatiques en cours (une tâche active qui a déjà `autoRetries`
 * > 0 : sans elle, l'autre appareil ne verrait pas qu'on vient de relancer ;
 * elle est sans risque, la terminée plus récente la remplace), dans
 * un ordre fixe (le même document sur tous les appareils, donc pas d'écriture
 * inutile quand rien n'a changé).
 */
export function sharedView(state, opts) {
  const m = mergeTasks(state, null, opts);
  const tasks = m.tasks.filter((task) => isFinished(task) || task.autoRetries > 0)
    .sort((x, y) => (y.finishedAt || 0) - (x.finishedAt || 0) || (x.id < y.id ? -1 : 1));
  const cleared = Object.fromEntries(Object.entries(m.cleared).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  return { v: 1, tasks, cleared };
}
