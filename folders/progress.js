// Progression de lecture (READ-002 §4.6) : un enregistrement par (profil, série, chapitre).
//
// Modèle commun : { page, completed, date, pages }, où `pages` est le nombre de pages connu au moment de
// l'enregistrement (un chapitre-archive ne le connaît qu'après sa première ouverture : c'est ici qu'il est
// conservé). Le profil est un identifiant opaque (`main` par défaut) : le service ne connaît ni les noms ni
// la liste des profils.
//
// Interface de stockage, seule porte d'entrée du reste du service :
//   snapshot(profil)                  → Map série → Map chapitre → enregistrement (lecture seule)
//   setMany(profil, série, [[chapitre, enregistrement]…])
//   clear(profil, série, [chapitre…])
//   recent(profil, { completed })     → [{ sid, bid, rec }], du plus récent au plus ancien
//   forgetProfile(profil)
//   flush(), close()
// Deux réalisations : fichiers (V1, createFileProgress) et mémoire (tests, createMemoryProgress).
//
// Sur disque : `progress/<profil>/<série>.json` = { idChapitre: [page, terminé, date, nombrePages] }.
// Écritures atomiques (fichier temporaire, synchronisation, renommage), une à la fois, regroupées : au plus
// une écriture par fichier toutes les `flushMs`, et à l'arrêt. Jamais de purge automatique : la progression
// d'un chapitre disparu est gardée, elle revient si le fichier revient au même chemin.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './store.js';
import { isBookId, isSeriesId, seriesOfBook } from './ids.js';

export const MAIN = 'main';
export const MAX_PROFILES = 50;
const PROFILE = /^[A-Za-z0-9]{1,32}$/;
const SERIES_FILE = /^([0-9a-f]{16})\.json$/;

export const isProfileId = (id) => typeof id === 'string' && PROFILE.test(id);
/** Le dossier de progression est illisible (entrée-sortie, droits) : pas de réponse approximative, on réessaiera. */
export class ProgressUnavailable extends Error {}
/** Trop de profils distincts : la progression d'un nouveau profil n'est pas enregistrée. */
export class ProfileLimit extends Error {}

const toDisk = (map) => Object.fromEntries([...map].map(([bid, r]) => [bid, [r.page, r.completed ? 1 : 0, r.date, r.pages]]));
const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 1e7;

/** Lit le contenu d'un fichier de série ; null si sa forme n'est pas celle attendue. Les entrées invalides sont écartées. */
function fromDisk(sid, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map = new Map();
  let dropped = 0;
  for (const [bid, v] of Object.entries(raw)) {
    const ok = isBookId(bid) && seriesOfBook(bid) === sid && Array.isArray(v) && v.length === 4
      && isCount(v[0]) && (v[1] === 0 || v[1] === 1) && Number.isInteger(v[2]) && v[2] > 0 && (v[3] === null || isCount(v[3]));
    if (ok) map.set(bid, { page: v[0], completed: v[1] === 1, date: v[2], pages: v[3] });
    else dropped++;
  }
  return { map, dropped };
}

/** Logique commune ; `backend` ne s'occupe que de lire et d'écrire (voir les deux réalisations). */
function createStore(backend) {
  const profiles = new Map(); // profil → Map(série → Map(chapitre → enregistrement))
  const loading = new Map();
  let known = null;           // identifiants de profil déjà présents

  async function load(profile) {
    if (!isProfileId(profile)) throw new Error('profil invalide');
    if (!profiles.has(profile)) {
      if (!loading.has(profile)) {
        // Un échec n'est pas retenu (la lecture sera retentée), et on ne repart jamais d'une table vide :
        // une écriture par-dessus ferait perdre ce qui n'a pas pu être lu.
        loading.set(profile, backend.load(profile).then((data) => { profiles.set(profile, data); },
          (e) => { throw new ProgressUnavailable(e.code || e.message); }).finally(() => loading.delete(profile)));
      }
      await loading.get(profile);
    }
    return profiles.get(profile);
  }
  async function knownProfiles() { return (known ??= new Set(await backend.profiles())); }
  /** Table d'une série, créée si besoin ; refuse un profil de plus au-delà de MAX_PROFILES. */
  async function seriesMap(profile, sid, create) {
    const data = await load(profile);
    if (!isSeriesId(sid)) throw new Error('série invalide');
    let map = data.get(sid);
    if (!map && create) {
      const set = await knownProfiles();
      if (!set.has(profile)) {
        if (set.size >= MAX_PROFILES) throw new ProfileLimit('trop de profils');
        set.add(profile);
      }
      data.set(sid, (map = new Map()));
    }
    return map;
  }

  return {
    async snapshot(profile) { return load(profile); },

    async setMany(profile, sid, entries) {
      const map = await seriesMap(profile, sid, true);
      for (const [bid, rec] of entries) {
        if (!isBookId(bid) || seriesOfBook(bid) !== sid) throw new Error('chapitre invalide');
        map.set(bid, { page: rec.page, completed: !!rec.completed, date: rec.date, pages: rec.pages ?? null });
      }
      backend.save(profile, sid, map);
    },

    async clear(profile, sid, bids) {
      const map = await seriesMap(profile, sid, false);
      if (!map) return;
      let changed = false;
      for (const bid of bids) changed = map.delete(bid) || changed;
      if (changed) backend.save(profile, sid, map);
    },

    /** Enregistrements d'un profil, du plus récent au plus ancien ; `completed` : true, false, ou absent pour tous. */
    async recent(profile, { completed } = {}) {
      const out = [];
      for (const [sid, map] of await load(profile)) {
        for (const [bid, rec] of map) if (completed === undefined || rec.completed === completed) out.push({ sid, bid, rec });
      }
      return out.sort((a, b) => b.rec.date - a.rec.date || (a.bid < b.bid ? -1 : 1));
    },

    async forgetProfile(profile) {
      await load(profile);
      profiles.set(profile, new Map());
      (await knownProfiles()).delete(profile);
      await backend.drop(profile);
    },

    flush: () => backend.flush(),
    close: () => backend.close(),
  };
}

/** Réalisation en mémoire (tests) : rien n'est conservé. */
export function createMemoryProgress() {
  return createStore({
    profiles: async () => [],
    load: async () => new Map(),
    save() {},
    drop: async () => {},
    flush: async () => {},
    close: async () => {},
  });
}

/**
 * Réalisation sur fichiers, dans `<dataDir>/progress`. Un fichier illisible (JSON invalide, forme inattendue) est
 * mis de côté sous `<nom>.corrupt` (le dernier est gardé) et la série repart à zéro : jamais réécrit par-dessus,
 * pour qu'une réparation à la main reste possible. Une écriture interrompue ne laisse qu'un `.tmp` ignoré :
 * le fichier précédent est intact, puisque le renommage est la seule étape qui le remplace.
 */
export function createFileProgress({ dataDir, flushMs = 3000, log = console }) {
  const root = join(dataDir, 'progress');
  const dirty = new Map(); // « profil/série » → { profile, sid, map }
  let timer = null;
  let writing = Promise.resolve();
  let closed = false;

  const backend = {
    async profiles() {
      try { return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && isProfileId(e.name)).map((e) => e.name); } catch { return []; }
    },

    async load(profile) {
      const dir = join(root, profile);
      const data = new Map();
      let names;
      try { names = await fs.readdir(dir); } catch (e) {
        if (e.code === 'ENOENT') return data;
        throw e;
      }
      for (const name of names) {
        const m = SERIES_FILE.exec(name);
        if (!m) continue; // .tmp d'une écriture interrompue, .corrupt, autres
        const file = join(dir, name);
        let parsed = null;
        try { parsed = fromDisk(m[1], JSON.parse(await fs.readFile(file, 'utf8'))); } catch { /* JSON invalide */ }
        if (!parsed) {
          log.warn(`Progression illisible, mise de côté : ${profile}/${name}.corrupt`);
          await fs.rename(file, `${file}.corrupt`).catch(() => {});
          continue;
        }
        if (parsed.dropped) log.warn(`Progression : ${parsed.dropped} entrée(s) invalide(s) ignorée(s) dans ${profile}/${name}`);
        if (parsed.map.size) data.set(m[1], parsed.map);
      }
      return data;
    },

    save(profile, sid, map) {
      if (closed) return;
      dirty.set(`${profile}/${sid}`, { profile, sid, map });
      if (!timer) timer = setTimeout(() => { timer = null; backend.flush(); }, flushMs);
    },

    flush() {
      clearTimeout(timer); timer = null;
      writing = writing.then(async () => {
        const batch = [...dirty.entries()];
        dirty.clear();
        let failed = false;
        for (const [key, item] of batch) {
          try {
            await fs.mkdir(join(root, item.profile), { recursive: true, mode: 0o700 });
            await writeAtomic(join(root, item.profile, `${item.sid}.json`), JSON.stringify(toDisk(item.map)));
          } catch (e) {
            // Disque plein, droits : l'entrée reste à écrire, on réessaie au prochain passage.
            log.warn(`Progression non écrite (${e.code || e.message}), nouvel essai dans ${Math.max(flushMs, 1000) / 1000} s`);
            if (!dirty.has(key)) dirty.set(key, item);
            failed = true;
          }
        }
        if (failed && !closed && !timer) timer = setTimeout(() => { timer = null; backend.flush(); }, Math.max(flushMs, 1000));
      });
      return writing;
    },

    async drop(profile) {
      for (const key of [...dirty.keys()]) if (key.startsWith(profile + '/')) dirty.delete(key);
      await writing;
      await fs.rm(join(root, profile), { recursive: true, force: true });
    },

    async close() {
      await backend.flush();
      closed = true;
      clearTimeout(timer); timer = null;
      if (dirty.size) log.warn(`Progression non écrite à l'arrêt : ${dirty.size} fichier(s)`);
    },
  };
  return createStore(backend);
}
