// Lecture et validation stricte de la configuration (READ-002 §4.10).
// Le service refuse de démarrer plutôt que de deviner : mode d'authentification
// explicite, variables connues, limites numériques.
import { promises as fs, constants } from 'node:fs';
import { join } from 'node:path';
import { isIgnoredName } from './naming.js';

export class ConfigError extends Error {}

const fail = (message) => { throw new ConfigError(message); };

// Limites numériques : [défaut, minimum, maximum].
const LIMITS = {
  FOLDERS_PORT: ['port', 8788, 1, 65535],
  FOLDERS_RESCAN_MINUTES: ['rescanMinutes', 15, 0, 10080],
  FOLDERS_SESSION_HOURS: ['sessionHours', 720, 1, 8760],
  FOLDERS_LOGIN_ATTEMPTS: ['loginAttempts', 5, 1, 100],
  FOLDERS_LOGIN_WINDOW_SECONDS: ['loginWindowSeconds', 900, 10, 86400],
  FOLDERS_TRUST_PROXY: ['trustProxy', 0, 0, 1],
  FOLDERS_PROGRESS_FLUSH_SECONDS: ['progressFlushSeconds', 3, 0, 60], // regroupement des écritures de progression (0 : tout de suite)
};
const TEXTS = ['FOLDERS_AUTH', 'FOLDERS_USER', 'FOLDERS_PASSWORD', 'FOLDERS_LIBRARIES_DIR', 'FOLDERS_DATA_DIR', 'FOLDERS_COOKIE_PATH'];
export const KNOWN = new Set([...Object.keys(LIMITS), ...TEXTS]);

/** Lit l'environnement ; lève ConfigError avec un message d'une ligne. */
export function readConfig(env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith('FOLDERS_') && !KNOWN.has(name)) fail(`Variable inconnue : ${name}.`);
  }
  const text = (name, fallback = '') => (env[name] === undefined ? fallback : String(env[name]));

  const auth = text('FOLDERS_AUTH');
  if (auth !== 'password' && auth !== 'none') fail('FOLDERS_AUTH doit valoir « password » ou « none » (aucun défaut implicite).');
  const user = text('FOLDERS_USER');
  const password = text('FOLDERS_PASSWORD');
  if (auth === 'password') {
    if (!user.trim() || !password) fail('Le mode password exige FOLDERS_USER et FOLDERS_PASSWORD.');
    if (password.length < 12) fail('FOLDERS_PASSWORD doit compter au moins 12 caractères.');
  } else if (user || password) {
    fail('Le mode none est ambigu avec FOLDERS_USER ou FOLDERS_PASSWORD renseigné : videz-les ou choisissez password.');
  }

  const config = { auth, user, password };
  for (const [name, [key, fallback, min, max]] of Object.entries(LIMITS)) {
    const raw = env[name];
    if (raw === undefined || raw === '') { config[key] = fallback; continue; }
    if (!/^\d{1,9}$/.test(String(raw))) fail(`${name} doit être un nombre entier.`);
    const n = Number(raw);
    if (n < min || n > max) fail(`${name} doit être compris entre ${min} et ${max}.`);
    config[key] = n;
  }
  config.trustProxy = config.trustProxy === 1;
  config.progressFlushMs = config.progressFlushSeconds * 1000;

  config.librariesDir = text('FOLDERS_LIBRARIES_DIR') || '/libraries';
  config.dataDir = text('FOLDERS_DATA_DIR') || '/data';
  config.cookiePath = text('FOLDERS_COOKIE_PATH') || '/';
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(config.cookiePath)) fail('FOLDERS_COOKIE_PATH doit être un chemin commençant par « / ».');

  // Délais de validité de l'index (§4.8) ; fixes en production, réglables par les tests.
  Object.assign(config, { listTtlMs: 60000, seriesTtlMs: 30000, retryMs: 5000 });
  return config;
}

/** Les bibliothèques sont les sous-dossiers directs de la racine ; liens symboliques non suivis. */
export async function findLibraries(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !isIgnoredName(e.name) && !e.name.includes('�'))
    .map((e) => ({ name: e.name.normalize('NFC').trim(), root: join(dir, e.name) }))
    .filter((l) => l.name)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Contrôles qui touchent le disque : au moins une bibliothèque, /data inscriptible. */
export async function checkFilesystem(config) {
  const libraries = await findLibraries(config.librariesDir);
  if (libraries.length === 0) fail(`Aucune bibliothèque sous ${config.librariesDir} : montez au moins un dossier.`);
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.access(config.dataDir, constants.W_OK);
    const probe = join(config.dataDir, `.ecriture-${process.pid}`);
    await fs.writeFile(probe, '');
    await fs.rm(probe);
  } catch {
    fail(`Le dossier de données ${config.dataDir} n'est pas inscriptible par cet utilisateur.`);
  }
  return libraries;
}
