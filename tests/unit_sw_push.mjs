// Unitaire : les gestionnaires « push » et « notificationclick » de app/sw.js, exécutés tels quels dans un contexte
// isolé (vm) avec un `self` factice. Aucun navigateur : le clic sur une vraie notification du système ne peut pas être
// déclenché dans Chromium sans écran, c'est donc ici que sa logique est vérifiée ; le test e2e (e2e_push.py) vérifie en
// plus, dans un vrai service worker, l'affichage et le message de navigation reçu par l'application.
// Lancer avec : node tests/unit_sw_push.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const source = readFileSync(join(APP, 'sw.js'), 'utf8');
const results = [];
/** Les objets créés dans le contexte vm n'ont pas les prototypes de ce contexte-ci : on compare des copies JSON. */
const plain = (x) => JSON.parse(JSON.stringify(x ?? null));
const test = (name, fn) => results.push([name, fn]);

/** Charge sw.js avec un `self` dont on contrôle les fenêtres ouvertes ; rend les gestionnaires et ce qu'ils ont fait. */
function load({ scope = 'https://example.test/app/', windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const clients = {
    matchAll: async (opts) => { clients.lastQuery = opts; return windows; },
    openWindow: async (url) => { opened.push(url); },
    claim: async () => {},
  };
  const self = {
    registration: { scope, showNotification: async (title, options) => { shown.push({ title, options }); } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients, skipWaiting: async () => {},
  };
  vm.runInNewContext(source, { self, URL, console, location: { origin: new URL(scope).origin } });
  return { listeners, shown, opened, clients };
}
/** Événement push dont la charge utile est `data` (objet, chaîne illisible, ou absente). */
const pushEvent = (data) => {
  const waits = [];
  return { waits, data: data === undefined ? null : { json: () => { if (typeof data === 'string') throw new SyntaxError('illisible'); return data; } }, waitUntil: (p) => waits.push(p) };
};
const fire = async (event, handler) => { handler(event); await Promise.all(event.waits); };
const clickEvent = (data) => {
  const waits = [];
  const notification = { closed: 0, data, close() { this.closed++; } };
  return { waits, notification, waitUntil: (p) => waits.push(p) };
};
const win = (url) => ({ url, focused: 0, messages: [], focus() { this.focused++; return Promise.resolve(this); }, postMessage(m) { this.messages.push(m); } });

test('push: the notification shows the title, body and tag sent by the notifier, and keeps the path for the click', async () => {
  const sw = load();
  await fire(pushEvent({ title: 'Les Veilleurs de Brume', body: 'New chapter: Chapitre 39', tag: 'series-s:1', path: '/series/s:1' }), sw.listeners.push);
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'Les Veilleurs de Brume');
  assert.deepEqual(plain(sw.shown[0].options), { body: 'New chapter: Chapitre 39', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'series-s:1', data: { path: '/series/s:1' } });
});
test('push: the icons it points to exist in the application', () => {
  for (const f of ['icons/icon-192.png', 'icons/badge-96.png']) assert.ok(existsSync(join(APP, f)), f);
  assert.match(source, /'js\/push\.js'/, 'push.js fait partie de la coquille hors ligne');
});
test('push: missing or unusable pieces fall back to safe defaults (title Scrollarr, empty body, path /home)', async () => {
  for (const data of [{}, { title: '', body: '' }, { path: 5 }, { path: null }, { path: { a: 1 } }, undefined, 'pas du json']) {
    const sw = load();
    await fire(pushEvent(data), sw.listeners.push);
    assert.equal(sw.shown.length, 1, 'une notification s\'affiche toujours (le navigateur l\'exige) : ' + JSON.stringify(data));
    assert.equal(sw.shown[0].title, 'Scrollarr');
    assert.equal(sw.shown[0].options.body, '');
    assert.equal(sw.shown[0].options.data.path, '/home');
  }
  const sw = load();
  await fire(pushEvent({ title: 'T', path: '/series/s:1' }), sw.listeners.push);
  assert.deepEqual([sw.shown[0].title, sw.shown[0].options.body, sw.shown[0].options.tag, sw.shown[0].options.data.path], ['T', '', undefined, '/series/s:1']);
});
test('push: the showing is handed to waitUntil (the worker is kept alive until the notification is displayed)', async () => {
  const sw = load();
  const event = pushEvent({ title: 'x' });
  sw.listeners.push(event);
  assert.equal(event.waits.length, 1);
  assert.ok(event.waits[0] instanceof Promise);
  await event.waits[0];
});
test('click: closes the notification and tells the open application window to go to the path, focusing it', async () => {
  const other = win('https://example.test/elsewhere/');
  const app = win('https://example.test/app/#/home');
  const sw = load({ windows: [other, app] });
  const event = clickEvent({ path: '/series/s:1' });
  await fire(event, sw.listeners.notificationclick);
  assert.equal(event.notification.closed, 1);
  assert.deepEqual([app.focused, plain(app.messages)], [1, [{ type: 'navigate', path: '/series/s:1' }]]);
  assert.deepEqual([other.focused, plain(other.messages)], [0, []], 'une fenêtre hors de l\'application est laissée tranquille');
  assert.deepEqual(plain(sw.opened), []);
  assert.deepEqual(plain(sw.clients.lastQuery), { type: 'window', includeUncontrolled: true });
});
test('click: no application window open: opens the application at that path, under its own scope', async () => {
  for (const windows of [[], [win('https://example.test/elsewhere/')]]) {
    const sw = load({ windows });
    const event = clickEvent({ path: '/series/k:S001' });
    await fire(event, sw.listeners.notificationclick);
    assert.deepEqual(plain(sw.opened), ['/app/#/series/k:S001']);
    assert.equal(event.notification.closed, 1);
  }
  const root = load({ scope: 'https://example.test/' });
  await fire(clickEvent({ path: '/my/subscriptions' }), root.listeners.notificationclick);
  assert.deepEqual(plain(root.opened), ['/#/my/subscriptions']);
});
test('click: a notification without a path goes home', async () => {
  for (const data of [undefined, {}, { path: '' }, null]) {
    const app = win('https://example.test/app/');
    const sw = load({ windows: [app] });
    await fire(clickEvent(data), sw.listeners.notificationclick);
    assert.deepEqual(plain(app.messages), [{ type: 'navigate', path: '/home' }], JSON.stringify(data));
  }
});
test('fetch: the notifier\'s routes and servers.json are never served from the cache (left to the network)', () => {
  const sw = load();
  for (const path of ['/app/notify/vapid', '/app/notify/subscribe', '/app/servers.json']) {
    for (const method of ['GET', 'POST']) {
      let intercepted = false;
      sw.listeners.fetch({ request: { method, url: 'https://example.test' + path, mode: 'cors' }, respondWith: () => { intercepted = true; }, waitUntil() {} });
      assert.equal(intercepted, false, `${method} ${path}`);
    }
  }
});

let failed = 0;
for (const [name, fn] of results) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n  ')); }
}
console.log(failed ? `\n${failed} test(s) failed (service worker push)` : `\nAll service worker push tests passed (${results.length})`);
process.exit(failed ? 1 : 0);
