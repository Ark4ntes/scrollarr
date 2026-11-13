// Unit test: display name of the main profile with an English interface (profiles.js, i18n.js, sync.js). No browser.
// The French side is in unit_profiles.mjs (the language of the interface is read once per process).
// Run with: node tests/unit_profile_name.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = new URL('http://localhost/');
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'en-US' }, configurable: true }); } catch { /* déjà défini */ }
globalThis.fetch = async () => { throw new TypeError('network'); };

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e)); }
}

// Liste déjà enregistrée par une version précédente : le nom par défaut est « Principal ».
localStorage.setItem('scrollarr.profiles.cache', JSON.stringify([{ id: 'main', name: 'Principal' }, { id: 'p1', name: 'Principal' }, { id: 'p2', name: 'Duo' }]));
const profiles = await import('../app/js/profiles.js');
const { mergeProfiles } = await import('../app/js/sync.js');
const mainOf = () => profiles.list().find((p) => p.id === 'main');
const storedMain = () => JSON.parse(localStorage.getItem('scrollarr.profiles.cache')).find((p) => p.id === 'main');

await test('English interface: an old stored list shows the main profile as "Main"', () => {
  assert.equal(mainOf().name, 'Principal');                       // la donnée n'a pas changé
  assert.equal(profiles.displayName(mainOf()), 'Main');
});
await test('English interface: another profile called "Principal" is not translated, other names are untouched', () => {
  assert.equal(profiles.displayName(profiles.list().find((p) => p.id === 'p1')), 'Principal');
  assert.equal(profiles.displayName(profiles.list().find((p) => p.id === 'p2')), 'Duo');
});
await test('English interface: renaming another profile does not touch the main one', async () => {
  await profiles.rename('p2', 'Trio').catch(() => {}); // pas de serveur ici : la liste locale est déjà à jour
  assert.equal(profiles.displayName(profiles.list().find((p) => p.id === 'p2')), 'Trio');
  assert.equal(storedMain().name, 'Principal');
});
await test('English interface: a custom main name is kept, and validating the shown "Main" keeps the default stored name', async () => {
  await profiles.rename('main', 'Papa').catch(() => {}); // pas de serveur ici : la liste locale est déjà à jour
  assert.equal(profiles.displayName(mainOf()), 'Papa');
  assert.equal(storedMain().name, 'Papa');
  await profiles.rename('main', 'Main').catch(() => {}); // pas de serveur ici : la liste locale est déjà à jour                           // l'utilisateur valide le nom affiché
  assert.equal(storedMain().name, 'Principal');                    // l'autre appareil, en français, verra « Principal »
  assert.equal(profiles.displayName(mainOf()), 'Main');
});
await test('merge: an older device that still writes "Principal" and a renamed main profile', () => {
  const older = [{ id: 'main', name: 'Principal' }];
  const renamed = [{ id: 'main', name: 'Papa', rev: 1, dev: 'a' }];
  assert.equal(mergeProfiles(older, renamed).find((p) => p.id === 'main').name, 'Papa');   // le nom choisi gagne sur le défaut sans révision
  assert.equal(mergeProfiles(renamed, older).find((p) => p.id === 'main').name, 'Papa');
  assert.equal(mergeProfiles(older, [{ id: 'main', name: 'Principal' }]).length, 1);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll profile name tests passed');
process.exit(failed ? 1 : 0);
