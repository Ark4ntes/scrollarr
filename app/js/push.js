// Notifications push (facultatives) : nécessitent le service « notifier »
// déployé à côté de l'application.
import { NOTIFY } from './config.js';
import { favoriteIds, events as storeEvents } from './store.js';
import { lang } from './i18n.js';

const FLAG = 'scrollarr.push';

export const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Clé publique VAPID du notifier, ou null s'il n'est pas déployé. */
export async function serverKey() {
  try {
    const r = await fetch(NOTIFY + '/vapid', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return (await r.json()).publicKey || null;
  } catch { return null; }
}

function keyBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const post = (path, body) =>
  fetch(NOTIFY + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function isEnabled() {
  return localStorage.getItem(FLAG) === '1' && Notification.permission === 'granted' && !!(await current());
}

export async function enable() {
  const key = await serverKey();
  if (!key) throw new Error('no-server');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const res = await post('/subscribe', { subscription: sub.toJSON(), favorites: favoriteIds(), lang: lang() });
  if (!res.ok) throw new Error('server-' + res.status);
  localStorage.setItem(FLAG, '1');
}

export async function disable() {
  localStorage.removeItem(FLAG);
  const sub = await current();
  if (!sub) return;
  await post('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function sendTest() {
  const sub = await current();
  if (!sub) throw new Error('not-subscribed');
  const res = await post('/test', { endpoint: sub.endpoint });
  if (!res.ok) throw new Error('server-' + res.status);
}

/** Le notifier doit connaître les séries suivies : on lui renvoie la liste à chaque changement. */
export function watchFavorites() {
  let last = '';
  const sync = async () => {
    if (!(await isEnabled())) return;
    const ids = favoriteIds();
    const sig = ids.slice().sort().join(',');
    if (sig === last) return;
    const sub = await current();
    const res = await post('/subscribe', { subscription: sub.toJSON(), favorites: ids, lang: lang() }).catch(() => null);
    if (res?.ok) last = sig;
  };
  storeEvents.addEventListener('favorites', sync);
  sync();
}
