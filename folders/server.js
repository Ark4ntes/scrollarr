// Scrollarr folders — lit des dossiers de scans montés en lecture seule.
// Service facultatif, placé derrière le proxy de l'application (chemin /folders/).
//
// Variables d'environnement (voir README.md) :
//   FOLDERS_AUTH      obligatoire : « password » ou « none » (aucun défaut)
//   FOLDERS_USER, FOLDERS_PASSWORD   mode password (mot de passe de 12 caractères au moins)
//   FOLDERS_PORT      port d'écoute (défaut : 8788)
//   FOLDERS_RESCAN_MINUTES, FOLDERS_SESSION_HOURS, FOLDERS_LOGIN_ATTEMPTS,
//   FOLDERS_LOGIN_WINDOW_SECONDS, FOLDERS_TRUST_PROXY, FOLDERS_COOKIE_PATH, FOLDERS_PROGRESS_FLUSH_SECONDS,
//   FOLDERS_LIBRARIES_DIR (défaut : /libraries), FOLDERS_DATA_DIR (défaut : /data)
import { start } from './app.js';
import { ConfigError } from './config.js';

try {
  const app = await start(process.env);
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (e) {
  console.error(e instanceof ConfigError ? `Configuration invalide : ${e.message}` : e);
  process.exit(1);
}
