// Décisions manuelles sur les séries en double : « ces deux séries sont la même
// œuvre » (same) ou « ce ne sont pas la même œuvre » (diff). Fonctions pures :
// ni navigateur ni réseau, testées dans tests/unit_matching.mjs.
//
// Une série est désignée par un triplet { s, i, t } : identifiant du serveur,
// identifiant natif de la série chez ce serveur, titre au moment de la décision.
// L'identifiant natif ne sert qu'avec son serveur : il n'identifie jamais la série
// à lui seul (docs/ROADMAP.md §3.3). Le titre ne sert pas à comparer : il permet
// d'afficher une décision dont la série n'existe plus (dossier renommé, par exemple).
//
// Le document, un par installation :
//   { v: 1, e: [ { k: 'same' | 'diff', a: [s, i, t], b: [s, i, t], rev, dev, at, del? } ] }
// Une entrée désigne une paire non ordonnée (a avant b dans l'ordre des clés). Comme les
// abonnements (sync.js), chaque entrée porte une révision et l'appareil qui l'a écrite ;
// défaire une décision laisse une marque (del) pour que les autres appareils ne la ramènent pas.
//
// Règles de lecture :
//  - « same » est transitif : A = B et B = C mettent A, B et C dans un même groupe ;
//  - un groupe compte au plus une série par serveur ;
//  - « diff » ne vaut que pour sa paire et jamais à l'intérieur d'un groupe.
// Deux appareils peuvent écrire des décisions qui, réunies, violent ces règles : groups() ne
// retient alors que les plus anciennes, de la même façon partout (voir `skipped`).
import { compareStamp } from './sync.js';

export const KIND = Object.freeze({ SAME: 'same', DIFF: 'diff' });
export const MAX_LIVE = 200;   // décisions actives gardées
export const MAX_TOMBS = 100;  // marques de décisions défaites gardées
const MAX_SERVER = 40;
const MAX_ID = 200;
const MAX_TITLE = 120;
const MAX_REV = 1e9;

// ───────────── Identités ─────────────

const str = (v) => (typeof v === 'string' ? v : Number.isFinite(v) ? String(v) : '');
const clip = (v, max) => str(v).slice(0, max);
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/** Série désignée par une décision. Le titre est borné ; serveur et identifiant sont obligatoires. */
export function ref(server, id, title = '') {
  return { s: clip(server, MAX_SERVER), i: clip(id, MAX_ID), t: clip(title, MAX_TITLE) };
}
const valid = (r) => !!r && !!r.s && !!r.i;
/** Clé d'une série : serveur et identifiant natif, sans le titre. */
export const refKey = (r) => `${r.s}:${encodeURIComponent(r.i)}`;
/** Clé d'une paire, la même quel que soit l'ordre. « | » ne peut pas figurer dans refKey. */
export const pairKey = (a, b) => [refKey(a), refKey(b)].sort().join('|');

const toTuple = (r) => [r.s, r.i, r.t];
const fromTuple = (x) => ({ s: x[0], i: x[1], t: x[2] });

// ───────────── Document ─────────────

export const emptyDoc = () => ({ v: 1, e: [] });

/** Entrée propre, ou null : tout ce qui n'a pas la forme attendue est écarté sans erreur. */
function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.a) || !Array.isArray(raw.b)) return null;
  if (raw.k !== KIND.SAME && raw.k !== KIND.DIFF) return null;
  const a = ref(raw.a[0], raw.a[1], raw.a[2]);
  const b = ref(raw.b[0], raw.b[1], raw.b[2]);
  if (!valid(a) || !valid(b) || refKey(a) === refKey(b)) return null;
  if (raw.k === KIND.SAME && a.s === b.s) return null; // une série par serveur dans un groupe
  const [x, y] = refKey(a) <= refKey(b) ? [a, b] : [b, a];
  const rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? Math.min(raw.rev, MAX_REV) : 0;
  const e = { k: raw.k, a: toTuple(x), b: toTuple(y), rev, dev: clip(raw.dev, MAX_SERVER), at: Number.isFinite(raw.at) && raw.at > 0 ? Math.floor(raw.at) : 0 };
  if (raw.del) { e.del = 1; e.a[2] = ''; e.b[2] = ''; } // une marque n'a pas besoin des titres
  return e;
}
const keyOf = (e) => pairKey(fromTuple(e.a), fromTuple(e.b));

// Ordre total entre deux versions d'une même paire : estampille, puis marque de suppression (elle
// l'emporte), puis des champs du contenu pour qu'aucune égalité ne dépende de l'ordre des appels.
function compareEntry(x, y) {
  return compareStamp(x.rev, x.dev, y.rev, y.dev)
    || (x.del || 0) - (y.del || 0)
    || x.at - y.at
    || cmp(x.k, y.k)
    || cmp(JSON.stringify(x), JSON.stringify(y));
}
// Ordre de conservation quand le document dépasse sa taille : les plus récentes d'abord.
const newestFirst = (x, y) => (y.e.at - x.e.at) || cmp(x.key, y.key);

function build(entries) {
  const byKey = new Map();
  for (const raw of entries) {
    const e = cleanEntry(raw);
    if (!e) continue;
    const key = keyOf(e);
    if (!byKey.has(key) || compareEntry(e, byKey.get(key)) > 0) byKey.set(key, e);
  }
  return byKey;
}
function finish(byKey) {
  const all = [...byKey].map(([key, e]) => ({ key, e }));
  const keep = (list, max) => list.sort(newestFirst).slice(0, max);
  const live = keep(all.filter((x) => !x.e.del), MAX_LIVE);
  const tombs = keep(all.filter((x) => x.e.del), MAX_TOMBS);
  // Ordre canonique : deux appareils qui ont les mêmes entrées écrivent le même texte.
  return { v: 1, e: [...live, ...tombs].sort((x, y) => cmp(x.key, y.key)).map((x) => x.e) };
}

/** Document propre à partir de n'importe quelle valeur (texte JSON déjà lu, objet, rien). */
export function sanitize(raw) {
  return finish(build(Array.isArray(raw?.e) ? raw.e : []));
}

/** Fusion de deux documents, paire par paire. Commutative et idempotente ; associative tant que la borne n'est pas atteinte. */
export function mergeDocs(a, b) {
  return finish(build([...(Array.isArray(a?.e) ? a.e : []), ...(Array.isArray(b?.e) ? b.e : [])]));
}

/** Décisions actives, avec leur clé. */
export function entries(doc) {
  return [...build(Array.isArray(doc?.e) ? doc.e : [])]
    .filter(([, e]) => !e.del)
    .map(([key, e]) => ({ key, kind: e.k, a: fromTuple(e.a), b: fromTuple(e.b), rev: e.rev, dev: e.dev, at: e.at }));
}

// ───────────── Groupes ─────────────

function conflict(ca, cb, diffs) {
  const servers = new Set([...ca.values()].map((m) => m.s));
  for (const m of cb.values()) if (servers.has(m.s)) return 'same-server';
  for (const x of ca.values()) for (const y of cb.values()) if (diffs.has(pairKey(x, y))) return 'differs';
  return null;
}

/**
 * Groupes de séries qui sont la même œuvre.
 *  - of      : Map refKey → { members: [ref], keys }, seulement pour les séries d'un groupe de deux ou plus ;
 *  - skipped : décisions « same » sans effet parce qu'elles réuniraient deux séries d'un même serveur ou deux
 *              séries déclarées différentes. On garde les plus anciennes ; l'ordre est le même sur tous les appareils.
 */
export function groups(doc) {
  const live = entries(doc);
  const diffs = new Set(live.filter((x) => x.kind === KIND.DIFF).map((x) => x.key));
  const comp = new Map(); // refKey → Map(refKey → ref), partagée par les membres d'un même groupe
  const skipped = new Map();
  const same = live.filter((x) => x.kind === KIND.SAME).sort((x, y) => (x.at - y.at) || cmp(x.key, y.key));
  for (const x of same) {
    const ka = refKey(x.a), kb = refKey(x.b);
    const ca = comp.get(ka) || new Map([[ka, x.a]]);
    const cb = comp.get(kb) || new Map([[kb, x.b]]);
    if (ca === cb) continue;
    const why = conflict(ca, cb, diffs);
    if (why) { skipped.set(x.key, why); continue; }
    for (const [k, r] of cb) ca.set(k, r);
    for (const k of ca.keys()) comp.set(k, ca);
  }
  const of = new Map();
  const made = new Map(); // un seul objet par groupe : deux membres du même groupe renvoient le même
  for (const [k, c] of comp) if (c.size > 1) { if (!made.has(c)) made.set(c, { members: [...c.values()] }); of.set(k, made.get(c)); }
  return { of, skipped };
}

/** Série et ses compagnes de groupe (elle comprise), ou null si elle n'est dans aucun groupe. */
export function groupOf(doc, r) {
  return groups(doc).of.get(refKey(r))?.members || null;
}

/** Ensemble des paires déclarées différentes. */
export function diffPairs(doc) {
  return new Set(entries(doc).filter((x) => x.kind === KIND.DIFF).map((x) => x.key));
}

// ───────────── Modifications ─────────────
// Chaque modification renvoie { ok, doc, changes } ou { ok: false, reason, with? }. `changes` garde l'état
// précédent de chaque paire touchée ({ key, prev }) : restore() s'en sert pour défaire.

const stamp = (prev, ctx) => ({ rev: Math.min(MAX_REV, (prev?.rev || 0) + 1), dev: clip(ctx.device, MAX_SERVER), at: Math.floor(ctx.now ?? 0) });
const find = (doc, key) => build(Array.isArray(doc?.e) ? doc.e : []).get(key);

function write(doc, writes, ctx) {
  const byKey = build(Array.isArray(doc?.e) ? doc.e : []);
  const changes = [];
  for (const { key, entry } of writes) {
    const prev = byKey.get(key);
    changes.push({ key, prev: prev && !prev.del ? prev : null });
    byKey.set(key, cleanEntry({ ...entry, ...stamp(prev, ctx) }));
  }
  return { ok: true, doc: finish(byKey), changes };
}

/** Raisons possibles d'un refus : same-server, differs, grouped, full, invalid. */
export function decide(doc, kind, a, b, ctx) {
  if (!valid(a) || !valid(b) || refKey(a) === refKey(b) || (kind !== KIND.SAME && kind !== KIND.DIFF)) return { ok: false, reason: 'invalid' };
  const key = pairKey(a, b);
  const { of } = groups(doc);
  const ga = of.get(refKey(a)), gb = of.get(refKey(b));
  if (kind === KIND.SAME) {
    if (a.s === b.s) return { ok: false, reason: 'same-server', with: [a, b] };
    if (!(ga && ga === gb)) {
      const ca = new Map((ga?.members || [a]).map((m) => [refKey(m), m]));
      const cb = new Map((gb?.members || [b]).map((m) => [refKey(m), m]));
      const diffs = diffPairs(doc);
      diffs.delete(key); // la décision qu'on remplace ne compte pas
      const why = conflict(ca, cb, diffs);
      if (why === 'same-server') {
        // Les séries déjà groupées qui occupent la place d'un serveur de l'autre côté.
        const wanted = new Set([...cb.values()].map((m) => m.s));
        return { ok: false, reason: why, with: [...ca.values()].filter((m) => wanted.has(m.s)) };
      }
      if (why) return { ok: false, reason: why };
    }
  } else if (ga && ga === gb) {
    return { ok: false, reason: 'grouped' }; // il faut d'abord sortir la série du groupe (detach)
  }
  const live = entries(doc);
  if (live.length >= MAX_LIVE && !live.some((x) => x.key === key)) return { ok: false, reason: 'full' };
  const t = (r) => clip(r.t, MAX_TITLE);
  const [x, y] = refKey(a) <= refKey(b) ? [a, b] : [b, a];
  return write(doc, [{ key, entry: { k: kind, a: [x.s, x.i, t(x)], b: [y.s, y.i, t(y)] } }], ctx);
}

/** Défait une décision (marque de suppression). Rien à faire si elle n'est pas active. */
export function remove(doc, key, ctx) {
  const cur = find(doc, key);
  if (!cur || cur.del) return { ok: true, doc: sanitize(doc), changes: [] };
  return write(doc, [{ key, entry: { ...cur, del: 1 } }], ctx);
}

/** Défait toutes les décisions « same » qui touchent cette série : elle sort de son groupe. */
export function detach(doc, r, ctx) {
  const k = refKey(r);
  const mine = entries(doc).filter((x) => x.kind === KIND.SAME && (refKey(x.a) === k || refKey(x.b) === k));
  if (!mine.length) return { ok: true, doc: sanitize(doc), changes: [] };
  const byKey = new Map(mine.map((x) => [x.key, find(doc, x.key)]));
  return write(doc, [...byKey].map(([key, cur]) => ({ key, entry: { ...cur, del: 1 } })), ctx);
}

/** Remet les paires dans l'état noté par `changes` (annuler). Une paire absente avant est défaite. */
export function restore(doc, changes, ctx) {
  const writes = [];
  for (const { key, prev } of changes) {
    const cur = find(doc, key);
    if (prev) writes.push({ key, entry: { k: prev.k, a: prev.a, b: prev.b } });
    else if (cur && !cur.del) writes.push({ key, entry: { ...cur, del: 1 } });
  }
  return write(doc, writes, ctx);
}

/** Réunit les `changes` de plusieurs modifications faites à la suite : pour une paire touchée deux fois, l'état d'origine compte. */
export function combine(...lists) {
  const seen = new Set();
  return lists.flat().filter((c) => !seen.has(c.key) && seen.add(c.key));
}

/** Fait-on référence à cette série dans une décision active ? Sert à compter ce qui touche une série. */
export const touches = (x, r) => refKey(x.a) === refKey(r) || refKey(x.b) === refKey(r);
