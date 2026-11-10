// Chemins relatifs au dossier où l'application est servie : fonctionne à la
// racine d'un sous-domaine comme dans un sous-dossier.
const base = new URL('.', location.href).pathname;

/** Préfixe du service de notifications push (optionnel). */
export const NOTIFY = base + 'notify';
export const APP_VERSION = '0.6.2';
export const SOURCE_URL = 'https://github.com/Ark4ntes/scrollarr';
export const DL_CACHE = 'scrollarr-dl-v1';
