// Lecture hors ligne : les pages sont copiées dans le Cache Storage du
// navigateur (le service worker les ressert ensuite), les métadonnées dans
// IndexedDB.
import * as api from './api.js';
import { idb } from './idb.js';
import { DL_CACHE } from './config.js';
import { pool } from './ui.js';

export const events = new EventTarget();
const emit = (bookId) => events.dispatchEvent(new CustomEvent('change', { detail: bookId }));

const state = new Map(); // bookId → enregistrement
const queue = [];
let loaded;
let running = false;

export const supported = () => 'caches' in window && 'indexedDB' in window;

export function load() {
  loaded ??= idb.all('downloads').then((rows) => {
    for (const r of rows) {
      // Un téléchargement interrompu par la fermeture de l'appli repart à la prochaine demande.
      if (r.status === 'downloading' || r.status === 'queued') r.status = 'paused';
      state.set(r.id, r);
    }
  });
  return loaded;
}

export const get = (bookId) => state.get(bookId);
export const all = () => [...state.values()];
export const isDone = (bookId) => state.get(bookId)?.status === 'done';

export async function enqueue(book, seriesTitle) {
  await load();
  if (!supported()) throw new Error('unsupported');
  const cur = state.get(book.id);
  if (cur && (cur.status === 'done' || cur.status === 'queued' || cur.status === 'downloading')) return;
  const rec = {
    id: book.id, seriesId: book.seriesId, seriesTitle: seriesTitle || book.seriesTitle,
    book, pages: null, status: 'queued', done: 0, total: book.media?.pagesCount || 0, bytes: 0, addedAt: Date.now(),
  };
  state.set(book.id, rec);
  await idb.set('downloads', book.id, rec);
  queue.push(book.id);
  emit(book.id);
  navigator.storage?.persist?.().catch(() => {});
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      const rec = state.get(id);
      if (!rec || rec.status !== 'queued') continue;
      await fetchBook(rec).catch(() => { rec.status = 'error'; });
      if (state.has(id)) { await idb.set('downloads', id, rec); emit(id); }
    }
  } finally { running = false; }
}

async function fetchBook(rec) {
  rec.status = 'downloading';
  emit(rec.id);
  const pages = (await api.bookPages(rec.id)).filter((p) => (p.mediaType || 'image/').startsWith('image/'));
  rec.pages = pages;
  rec.total = pages.length;
  rec.done = 0;
  rec.bytes = 0;
  const cache = await caches.open(DL_CACHE);
  const store = async (url) => {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    return blob.size;
  };
  // Vignettes : utiles pour afficher la liste hors ligne, sans bloquer en cas d'échec.
  await Promise.allSettled([store(api.bookThumb(rec.id)), store(api.seriesThumb(rec.seriesId))]);
  let failed = false;
  await pool(pages, 3, async (p) => {
    if (failed || !state.has(rec.id)) return;
    try {
      rec.bytes += await store(p.url);
      rec.done++;
      emit(rec.id);
    } catch { failed = true; }
  });
  if (!state.has(rec.id)) return; // supprimé pendant le téléchargement
  rec.status = failed ? 'error' : 'done';
}

export async function remove(bookId) {
  await load();
  const rec = state.get(bookId);
  if (!rec) return;
  state.delete(bookId);
  await idb.del('downloads', bookId);
  const cache = await caches.open(DL_CACHE);
  await Promise.all([
    cache.delete(api.bookThumb(bookId)),
    ...(rec.pages || []).map((p) => cache.delete(p.url)),
  ]);
  emit(bookId);
}

export async function removeSeries(seriesId) {
  for (const r of all().filter((r) => r.seriesId === seriesId)) await remove(r.id);
}

export async function usage() {
  const local = all().reduce((n, r) => n + (r.bytes || 0), 0);
  let quota = 0;
  try { quota = (await navigator.storage.estimate()).quota || 0; } catch { /* non disponible */ }
  return { used: local, quota };
}
