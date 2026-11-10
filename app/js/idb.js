// Petite surcouche IndexedDB : trois magasins clé → valeur.
const DB_NAME = 'scrollarr';
const STORES = ['kv', 'apicache', 'downloads'];
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const idb = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)).catch(() => undefined),
  set: (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)).catch(() => undefined),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)).catch(() => undefined),
  all: (store) => run(store, 'readonly', (s) => s.getAll()).then((r) => r || []).catch(() => []),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()).catch(() => undefined),
};
