// Réponses JSON ou image, lecture du corps et garde-fous inter-origines (READ-002 §4.10).
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const BODY_LIMIT = 64 * 1024;

// En-têtes ajoutés à toute réponse, en plus de ceux du proxy.
const COMMON = {
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

export function send(res, status, body, headers = {}) {
  const payload = status === 204 ? '' : JSON.stringify(body ?? {});
  res.writeHead(status, { ...COMMON, 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

// ── Images ──
// Validateurs calculés sur les quatre éléments d'une version de fichier (§4.8) ; `no-cache` impose la
// revalidation à chaque affichage, donc un 304 sans corps quand rien n'a changé. `private` : la page
// est derrière une session.
const IMAGE_CACHE = 'private, no-cache';
const IDLE_MS = 60000; // un client qui ne lit plus est coupé, pour libérer le fichier
const validators = ({ etag, mtimeMs }) => ({ 'Cache-Control': IMAGE_CACHE, ETag: etag, 'Last-Modified': new Date(mtimeMs).toUTCString() });

/** Le client a-t-il déjà la bonne version ? If-None-Match l'emporte sur If-Modified-Since (RFC 9110, 13.1). */
export function notModified(req, { etag, mtimeMs }) {
  const none = req.headers['if-none-match'];
  if (none !== undefined) return none.trim() === '*' || none.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
  const since = Date.parse(req.headers['if-modified-since'] ?? '');
  return !Number.isNaN(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

export function sendNotModified(res, source) {
  res.writeHead(304, { ...COMMON, ...validators(source) });
  res.end();
}

/** Envoie l'image en flux. Une erreur en cours de route coupe la connexion : le corps est plus court que Content-Length. */
export async function sendImage(res, source, { mediaType, body }) {
  res.writeHead(200, { ...COMMON, ...validators(source), 'Content-Type': mediaType, 'Content-Length': String(source.size) });
  res.setTimeout(IDLE_MS, () => res.destroy());
  await pipeline(Readable.from(body), res).catch(() => {}); // pipeline détruit la réponse et ferme le fichier
}

/** Corps JSON (objet), 64 Ko au plus. Un corps vide donne {}. */
export function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > limit) return reject(new HttpError(413, 'corps trop volumineux'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'corps trop volumineux')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(new HttpError(400, 'JSON invalide')); }
    });
  });
}

/**
 * Garde-fous contre les requêtes inter-origines, y compris sur un réseau local :
 *  - un `Origin` qui ne correspond pas à l'hôte est refusé (toute méthode) ;
 *  - hors GET, `X-Requested-With` et `Content-Type: application/json` sont exigés,
 *    ce qui impose une pré-vérification CORS à laquelle le service ne répond jamais.
 */
export function checkCrossOrigin(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* « null » ou invalide */ }
    if (!host || host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) throw new HttpError(403, 'origine refusée');
  }
  if (req.method !== 'GET') {
    if (!req.headers['x-requested-with']) throw new HttpError(403, 'en-tête X-Requested-With requis');
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type application/json requis');
  }
}

/** Adresse du client, pour la limitation des tentatives. Derrière le proxy de confiance : dernière entrée de X-Forwarded-For. */
export function clientAddress(req, trustProxy) {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'inconnue';
}
