// Assemble le service : configuration, dossiers, authentification, serveur HTTP.
// Écrit comme une bibliothèque (start) pour pouvoir réunir plus tard les
// services satellites ; server.js n'est que le point de départ.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readConfig, checkFilesystem } from './config.js';
import { loadSecret, createFlags } from './store.js';
import { createAuth } from './auth.js';
import { createLibraries } from './library.js';
import { createReading } from './reading.js';
import { createHandler } from './routes.js';

/** Démarre le service ; lève ConfigError si la configuration est invalide. `overrides` : réglages des tests. */
export async function start(env, overrides = {}) {
  const config = { ...readConfig(env), ...overrides };
  const mounts = await checkFilesystem(config);
  const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const auth = createAuth(config, await loadSecret(config.dataDir));
  const flags = await createFlags(config.dataDir).load();
  const log = config.log || console; // les tests passent un journal muet
  const reading = createReading();
  const libraries = createLibraries({ config, mounts, flags, log, onScan: reading.clear });

  if (config.auth === 'none') {
    log.warn('ATTENTION : FOLDERS_AUTH=none, aucun contrôle d\'accès. Réservé à un réseau local de confiance ou à un VPN.');
  }
  const server = http.createServer(createHandler({ config, auth, libraries, reading, version }));
  server.requestTimeout = 30000;
  server.maxConnections = 128;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, resolve); });
  const port = server.address().port;
  log.log(`Dossiers à l'écoute sur ${port} (authentification : ${config.auth}, bibliothèques : ${mounts.map((m) => m.name).join(', ')}).`);
  const scanned = libraries.start();
  return { server, port, libraries, scanned, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}
