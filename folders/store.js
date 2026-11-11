// Fichiers du dossier de données : clé de signature des sessions et
// mémoire « cette bibliothèque a déjà contenu des séries » (libraries.json).
// Écritures atomiques : fichier temporaire, synchronisation, renommage.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function writeAtomic(file, content, mode = 0o600) {
  const tmp = `${file}.tmp`;
  const handle = await fs.open(tmp, 'w', mode);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file);
}

/** Clé de signature des sessions, créée au premier démarrage. */
export async function loadSecret(dataDir) {
  const file = join(dataDir, 'secret.key');
  try {
    const key = (await fs.readFile(file, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(key)) return key;
  } catch { /* à créer */ }
  const key = randomBytes(32).toString('hex');
  await writeAtomic(file, key + '\n');
  return key;
}

export function createFlags(dataDir) {
  const file = join(dataDir, 'libraries.json');
  let flags = {};
  return {
    async load() {
      try { flags = JSON.parse(await fs.readFile(file, 'utf8')) || {}; } catch { flags = {}; }
      return this;
    },
    /** La bibliothèque a-t-elle déjà contenu des séries ? */
    hadSeries: (name) => flags[name] === true,
    async set(name, value) {
      if ((flags[name] === true) === value) return;
      flags = { ...flags, [name]: value };
      try { await writeAtomic(file, JSON.stringify(flags)); } catch (e) { console.warn('libraries.json non écrit :', e.code || e.message); }
    },
  };
}
