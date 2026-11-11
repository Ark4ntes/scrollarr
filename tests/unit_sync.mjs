// Unit tests for the merge rules (app/js/sync.js). Run with: node tests/unit_sync.mjs
import assert from 'node:assert/strict';
import { compareStamp, mergeSeries, mergeIdx, mergeFavs, mergeProfiles } from '../app/js/sync.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
// entry: [page, done, date, deleted, revision, device]
const E = (page, done, t, del, rev, dev) => [page, done, t, del, rev, dev];
const both = (merge, a, b) => { const x = merge(a, b), y = merge(b, a); assert.deepEqual(x, y, 'merge must not depend on the order'); return x; };

test('stamp: higher revision wins, device id breaks ties', () => {
  assert.ok(compareStamp(2, 'a', 1, 'z') > 0);
  assert.ok(compareStamp(1, 'b', 1, 'a') > 0);
  assert.equal(compareStamp(1, 'a', 1, 'a'), 0);
});

test('case 1: same chapter, same second, same revision → same result everywhere', () => {
  const a = { 12: E(4, 0, 1000, 0, 1, 'aaaa') };
  const b = { 12: E(9, 1, 1000, 0, 1, 'bbbb') };
  assert.deepEqual(both(mergeSeries, a, b)[12], b[12]);
});

test('case 2: a device whose clock is late still wins with a higher revision', () => {
  const a = { 12: E(9, 1, 2_000_000, 0, 1, 'aaaa') };          // clock two days ahead
  const b = { 12: E(0, 0, 1_000_000, 1, 2, 'bbbb') };          // later edit, older date
  assert.deepEqual(both(mergeSeries, a, b)[12], b[12]);
});

test('case 2: a device whose clock is ahead cannot overwrite a newer revision', () => {
  const a = { 12: E(3, 0, 9_000_000, 0, 1, 'aaaa') };
  const b = { 12: E(7, 0, 1_000_000, 0, 3, 'bbbb') };
  assert.deepEqual(both(mergeSeries, a, b)[12], b[12]);
});

test('same device, same revision: the furthest write wins', () => {
  const a = { 12: E(3, 0, 1000, 0, 2, 'aaaa') };
  const b = { 12: E(8, 0, 1004, 0, 2, 'aaaa') };
  assert.deepEqual(both(mergeSeries, a, b)[12], b[12]);
});

test('merge keeps chapters known by only one side', () => {
  const m = both(mergeSeries, { 1: E(1, 1, 10, 0, 1, 'a') }, { 2: E(1, 1, 11, 0, 1, 'b') });
  assert.deepEqual(Object.keys(m), ['1', '2']);
});

test('unread mark beats an older read, and loses to a later re-read', () => {
  const read = { 5: E(9, 1, 100, 0, 1, 'a') }, unread = { 5: E(0, 0, 90, 1, 2, 'b') }, again = { 5: E(2, 0, 80, 0, 3, 'a') };
  assert.equal(both(mergeSeries, read, unread)[5][3], 1);
  assert.equal(both(mergeSeries, unread, again)[5][3], 0);
});

test('entries written before revisions existed are ordered by date', () => {
  const m = both(mergeSeries, { 5: [3, 0, 100] }, { 5: [6, 0, 200] });
  assert.deepEqual(m[5], [6, 0, 200]);
  assert.deepEqual(both(mergeSeries, { 5: [3, 0, 999] }, { 5: E(1, 0, 1, 0, 1, 'a') })[5], E(1, 0, 1, 0, 1, 'a'));
});

test('merging is idempotent and associative', () => {
  const a = { 1: E(1, 0, 5, 0, 1, 'a') }, b = { 1: E(2, 0, 5, 0, 1, 'b') }, c = { 1: E(3, 1, 1, 0, 2, 'a'), 2: E(1, 0, 1, 0, 1, 'c') };
  assert.deepEqual(mergeSeries(a, a), a);
  assert.deepEqual(mergeSeries(mergeSeries(a, b), c), mergeSeries(a, mergeSeries(b, c)));
});

test('history: one line per chapter, winner by revision, sorted by date', () => {
  const a = { r: [{ b: 's:1.1', t: 500, p: 9, v: 1, d: 'a' }, { b: 's:2.1', t: 300, p: 1, v: 1, d: 'a' }] };
  const b = { r: [{ b: 's:1.1', t: 100, p: 2, v: 2, d: 'b' }, { b: 's:3.1', t: 400, p: 1, v: 1, d: 'b' }] };
  const m = both(mergeIdx, a, b);
  assert.deepEqual(m.r.map((e) => e.b), ['s:3.1', 's:2.1', 's:1.1']);
  assert.equal(m.r[2].p, 2);
  assert.equal(mergeIdx(a, b, 2).r.length, 2);
});

test('subscriptions: two devices each add one → both kept', () => {
  const a = { updatedAt: 5, items: { x: { id: 'x', added: 1, rev: 1, dev: 'a' } } };
  const b = { updatedAt: 9, items: { y: { id: 'y', added: 2, rev: 1, dev: 'b' } } };
  const m = both(mergeFavs, a, b);
  assert.deepEqual(Object.keys(m.items).sort(), ['x', 'y']);
  assert.equal(m.updatedAt, 9);
});

test('subscriptions: unsubscribing is not undone by a device that had not seen it', () => {
  const stale = { items: { x: { id: 'x', added: 1, seen: 3, rev: 1, dev: 'a' } } };
  const gone = { items: { x: { id: 'x', del: 1, rev: 2, dev: 'b' } } };
  assert.equal(both(mergeFavs, stale, gone).items.x.del, 1);
  const back = { items: { x: { id: 'x', added: 7, rev: 3, dev: 'a' } } };
  assert.equal(both(mergeFavs, gone, back).items.x.del, undefined);
});

test('subscriptions: lists saved before revisions existed are still read', () => {
  const old = { updatedAt: 3, items: { x: { id: 'x', title: 'X', seen: 2, added: 1 } } };
  assert.deepEqual(both(mergeFavs, old, null).items, old.items);
  assert.equal(both(mergeFavs, old, { items: { x: { id: 'x', del: 1, rev: 1, dev: 'a' } } }).items.x.del, 1);
});

// Profils : { id, name, added, rev, dev, del }
const P = (id, name, rev, dev, extra = {}) => ({ id, name, added: Number(id.slice(1)) || 0, rev, dev, ...extra });
const MAIN = { id: 'main', name: 'Principal' };
const ids = (l) => l.map((p) => p.id + (p.del ? '!' : ''));

test('profiles: a profile created elsewhere is not lost, whatever the order', () => {
  const a = [MAIN, P('p1', 'Duo', 1, 'a')];
  const b = [MAIN];                                   // serveur en retard
  assert.deepEqual(ids(both(mergeProfiles, a, b)), ['main', 'p1']);
  assert.deepEqual(ids(both(mergeProfiles, [MAIN, P('p1', 'Duo', 1, 'a')], [MAIN, P('p2', 'Trio', 1, 'b')])), ['main', 'p1', 'p2']);
});
test('profiles: a deletion stays deleted against a stale copy', () => {
  const gone = [MAIN, P('p1', 'Duo', 2, 'a', { del: 1 })];
  const stale = [MAIN, P('p1', 'Duo', 1, 'a')];
  assert.deepEqual(ids(both(mergeProfiles, gone, stale)), ['main', 'p1!']);
});
test('profiles: a rename made after another device wins by revision, not by arrival order', () => {
  const x = [MAIN, P('p1', 'Duo', 2, 'a')];
  const y = [MAIN, P('p1', 'Autre', 1, 'b')];
  assert.equal(both(mergeProfiles, x, y)[1].name, 'Duo');
});
test('profiles: same revision on two devices gives the same result everywhere', () => {
  const m = both(mergeProfiles, [MAIN, P('p1', 'A', 1, 'a')], [MAIN, P('p1', 'B', 1, 'b')]);
  assert.equal(m[1].dev, 'b');
});
test('profiles: lists written before stamps still load and are completed by stamped ones', () => {
  const old = [{ id: 'main', name: 'Principal' }, { id: 'p1', name: 'Duo' }, { id: 'p2', name: 'Trio' }];
  assert.deepEqual(ids(mergeProfiles(old, null)), ['main', 'p1', 'p2']);                       // ordre conservé
  assert.deepEqual(ids(both(mergeProfiles, old, [MAIN, P('p1', 'Duo', 2, 'a', { del: 1, added: 0 })])), ['main', 'p1!', 'p2']);
  assert.equal(both(mergeProfiles, old, [MAIN, P('p2', 'Renommé', 1, 'a')])[2].name, 'Renommé');
});
test('profiles: the main profile cannot be deleted and garbage entries are ignored', () => {
  const m = mergeProfiles([{ id: 'main', name: 'Principal', rev: 5, dev: 'a', del: 1 }, null, { name: 'sans id' }, 'x'], undefined);
  assert.deepEqual(m.map((p) => [p.id, !!p.del]), [['main', false]]);
});
test('profiles: tombstone beats an unstamped live copy of equal revision', () => {
  const m = both(mergeProfiles, [MAIN, { id: 'p1', name: 'Duo' }], [MAIN, { id: 'p1', name: 'Duo', del: 1 }]);
  assert.ok(m[1].del);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll sync unit tests passed');
process.exit(failed ? 1 : 0);
