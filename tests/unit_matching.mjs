// Unit tests for the manual series decisions (app/js/matching.js). No browser. Run with: node tests/unit_matching.mjs
import assert from 'node:assert/strict';
import * as m from '../app/js/matching.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.stack.split('\n').slice(0, 3).join('\n  ')); }
}

const R = (s, i, t = '') => m.ref(s, i, t);
const A = R('suwayomi', '1', 'Dr. Stone'), B = R('komga', '0AB', 'Dr Stone T01'), C = R('folders', 'f9', 'Dr. Stone T01 à T18 [CBZ FR]');
let clock = 1000;
const ctx = (device = 'dev1') => ({ device, now: ++clock });
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const apply = (doc, kind, a, b, c) => ok(m.decide(doc, kind, a, b, c || ctx())).doc;
const groupKeys = (doc, r) => (m.groupOf(doc, r) || []).map(m.refKey).sort();

test('a "same" decision groups the two series, whatever the order', () => {
  const d = apply(m.emptyDoc(), 'same', A, B);
  assert.deepEqual(groupKeys(d, A), groupKeys(d, B));
  assert.equal(groupKeys(d, A).length, 2);
  assert.equal(m.groupOf(d, C), null);
});

test('"same" is transitive: A=B and B=C put the three in one group', () => {
  let d = apply(m.emptyDoc(), 'same', A, B);
  d = apply(d, 'same', C, B);
  assert.equal(groupKeys(d, A).length, 3);
  assert.deepEqual(groupKeys(d, A), groupKeys(d, C));
});

test('at most one series per server: a decision that would break it is refused with the culprit', () => {
  const B2 = R('komga', '0CD', 'Other Komga series');
  let d = apply(m.emptyDoc(), 'same', A, B);
  const r = m.decide(d, 'same', A, B2, ctx());
  assert.equal(r.ok, false); assert.equal(r.reason, 'same-server');
  assert.deepEqual(r.with.map(m.refKey), [m.refKey(B)]);
  // joining two groups that both hold a series of the same server is refused too
  const C2 = R('folders', 'f1');
  const d2 = apply(m.emptyDoc(), 'same', B2, C2);
  d = apply(d, 'same', A, C);
  assert.equal(m.decide(d, 'same', A, C2, ctx()).reason, 'same-server');
  assert.equal(m.decide(d, 'same', B, C2, ctx()).reason, 'same-server');
  assert.equal(m.groupOf(d2, B2).length, 2);
  // same server on both sides
  assert.equal(m.decide(m.emptyDoc(), 'same', B, B2, ctx()).reason, 'same-server');
});

test('a group never gets two series of one server, even if documents from two devices say so', () => {
  const B2 = R('komga', '0CD', 'x');
  const d1 = apply(m.emptyDoc(), 'same', A, B, ctx('d1'));
  const d2 = apply(m.emptyDoc(), 'same', A, B2, ctx('d2'));
  const merged = m.mergeDocs(d1, d2);
  assert.deepEqual(merged, m.mergeDocs(d2, d1));
  const g = m.groups(merged);
  assert.equal(g.of.get(m.refKey(A)).members.length, 2, 'the oldest decision stands');
  assert.equal(g.skipped.size, 1);
  assert.equal([...g.skipped.values()][0], 'same-server');
  assert.ok(g.of.get(m.refKey(B)), 'B (the older decision) is kept');
  assert.equal(g.of.get(m.refKey(B2)), undefined);
});

test('"different" is for its pair only and never joins a group', () => {
  let d = apply(m.emptyDoc(), 'diff', A, B);
  assert.ok(m.diffPairs(d).has(m.pairKey(B, A)));
  assert.ok(!m.diffPairs(d).has(m.pairKey(A, C)));
  assert.equal(m.groupOf(d, A), null);
  // "same" on that pair replaces the "different" one
  d = apply(d, 'same', A, B);
  assert.equal(m.diffPairs(d).size, 0);
  assert.equal(groupKeys(d, A).length, 2);
  // and the other way round needs a detach first
  assert.equal(m.decide(d, 'diff', A, B, ctx()).reason, 'grouped');
  const out = ok(m.detach(d, B, ctx()));
  d = apply(out.doc, 'diff', A, B);
  assert.equal(m.groupOf(d, A), null);
  assert.ok(m.diffPairs(d).has(m.pairKey(A, B)));
});

test('"different" between two series blocks a grouping that would put them together', () => {
  let d = apply(m.emptyDoc(), 'same', A, B);
  d = apply(d, 'diff', A, C);
  const r = m.decide(d, 'same', B, C, ctx());
  assert.equal(r.ok, false); assert.equal(r.reason, 'differs');
  // same result when a "same" decision from another device would contradict it after a merge
  const other = apply(m.emptyDoc(), 'same', B, C, { device: 'd2', now: 5000 });
  const merged = m.mergeDocs(d, other);
  assert.equal(m.groups(merged).skipped.size, 1);
  assert.equal([...m.groups(merged).skipped.values()][0], 'differs');
  assert.equal(m.groupOf(merged, C), null);
});

test('undo: restore gives the previous state back, for a new, a replaced and a removed decision', () => {
  const empty = m.emptyDoc();
  const r1 = ok(m.decide(empty, 'same', A, B, ctx()));
  const undone = ok(m.restore(r1.doc, r1.changes, ctx())).doc;
  assert.equal(m.entries(undone).length, 0);
  assert.equal(m.groupOf(undone, A), null);
  // a removed decision comes back with its titles
  const r2 = ok(m.remove(r1.doc, m.pairKey(A, B), ctx()));
  assert.equal(m.groupOf(r2.doc, A), null);
  const back = ok(m.restore(r2.doc, r2.changes, ctx())).doc;
  const view = (doc) => m.entries(doc).map((x) => [x.kind, x.a.t, x.b.t]);
  assert.deepEqual(view(back), view(r1.doc));
  assert.ok(view(back)[0][1] || view(back)[0][2]);
  assert.equal(groupKeys(back, A).length, 2);
  // a replaced decision (diff -> same) goes back to diff
  const d0 = apply(empty, 'diff', A, B);
  const r3 = ok(m.decide(d0, 'same', A, B, ctx()));
  const rolled = ok(m.restore(r3.doc, r3.changes, ctx())).doc;
  assert.deepEqual(m.entries(rolled).map((x) => x.kind), ['diff']);
  // detach and its undo
  const g = apply(apply(empty, 'same', A, B), 'same', B, C);
  const det = ok(m.detach(g, B, ctx()));
  assert.equal(m.entries(det.doc).length, 0);
  assert.equal(det.changes.length, 2);
  assert.equal(groupKeys(ok(m.restore(det.doc, det.changes, ctx())).doc, A).length, 3);
});

test('removing or detaching something that is not there changes nothing', () => {
  const d = apply(m.emptyDoc(), 'same', A, B);
  assert.deepEqual(ok(m.remove(d, m.pairKey(A, C), ctx())).changes, []);
  assert.deepEqual(ok(m.detach(d, C, ctx())).changes, []);
});

// ── Merge ──
const sample = () => {
  const x = ok(m.decide(m.emptyDoc(), 'same', A, B, { device: 'd1', now: 10 })).doc;
  const y = ok(m.decide(m.emptyDoc(), 'diff', A, C, { device: 'd2', now: 20 })).doc;
  const z0 = ok(m.decide(m.emptyDoc(), 'same', A, B, { device: 'd3', now: 30 })).doc;          // same pair as x, same revision, other device
  const z = ok(m.remove(z0, m.pairKey(A, B), { device: 'd3', now: 40 })).doc;                  // ... then undone
  return [x, y, z];
};

test('merge is commutative, idempotent and associative (with tombstones)', () => {
  const [x, y, z] = sample();
  assert.deepEqual(m.mergeDocs(x, y), m.mergeDocs(y, x));
  assert.deepEqual(m.mergeDocs(x, x), m.sanitize(x));
  assert.deepEqual(m.mergeDocs(m.mergeDocs(x, y), z), m.mergeDocs(x, m.mergeDocs(y, z)));
  assert.deepEqual(m.mergeDocs(m.mergeDocs(x, y), z), m.mergeDocs(m.mergeDocs(z, x), y));
  assert.deepEqual(m.mergeDocs(x, null), m.sanitize(x));
});

test('a higher revision wins over a lower one; the tombstone of an undone decision is not brought back', () => {
  const live = ok(m.decide(m.emptyDoc(), 'same', A, B, { device: 'd1', now: 10 })).doc;      // rev 1
  const gone = ok(m.remove(live, m.pairKey(A, B), { device: 'd2', now: 20 })).doc;           // rev 2, tombstone
  const merged = m.mergeDocs(live, gone);
  assert.equal(m.entries(merged).length, 0);
  assert.equal(merged.e.length, 1);
  assert.equal(merged.e[0].del, 1);
  // a device that still has the old live entry cannot resurrect it
  assert.equal(m.entries(m.mergeDocs(gone, live)).length, 0);
  // re-deciding later (rev 3) does come back
  const again = ok(m.decide(merged, 'same', A, B, { device: 'd1', now: 30 })).doc;
  assert.equal(m.entries(m.mergeDocs(again, live)).length, 1);
});

test('same revision on two devices: the same winner everywhere (tombstone wins the tie)', () => {
  const a = ok(m.decide(m.emptyDoc(), 'same', A, B, { device: 'aaaa', now: 5 })).doc;
  const b = ok(m.decide(m.emptyDoc(), 'diff', A, B, { device: 'bbbb', now: 5 })).doc;
  assert.deepEqual(m.mergeDocs(a, b), m.mergeDocs(b, a));
  assert.equal(m.entries(m.mergeDocs(a, b))[0].kind, 'diff', 'higher device id wins');
  const t = ok(m.remove(m.mergeDocs(a, b), m.pairKey(A, B), { device: 'aaaa', now: 6 })).doc;  // rev 2
  const u = ok(m.decide(a, 'same', A, B, { device: 'zzzz', now: 7 })).doc;                     // rev 2, other device
  assert.deepEqual(m.mergeDocs(t, u), m.mergeDocs(u, t));
});

test('skewed clocks do not matter: order is by revision, not by date', () => {
  const live = ok(m.decide(m.emptyDoc(), 'same', A, B, { device: 'd1', now: 9e12 })).doc;
  const gone = ok(m.remove(live, m.pairKey(A, B), { device: 'd2', now: 1 })).doc;
  assert.equal(m.entries(m.mergeDocs(live, gone)).length, 0);
});

test('bound: live decisions and tombstones are capped, newest kept, same result in any order', () => {
  let d = m.emptyDoc();
  const big = (n) => R('suwayomi', 'a' + n, 't' + n);
  const hi = (n) => R('komga', 'b' + n, 'u' + n);
  // decide() refuses beyond the cap
  for (let n = 0; n < m.MAX_LIVE; n++) d = apply(d, 'same', big(n), hi(n), { device: 'd', now: 100 + n });
  assert.equal(m.entries(d).length, m.MAX_LIVE);
  const full = m.decide(d, 'same', big(999), hi(999), ctx());
  assert.equal(full.ok, false); assert.equal(full.reason, 'full');
  assert.equal(m.decide(d, 'diff', big(0), hi(1), ctx()).ok, false, 'a new pair is refused too');
  assert.equal(m.decide(d, 'diff', big(1), hi(1), ctx()).reason, 'grouped');
  // replacing an existing pair is still possible
  assert.ok(m.decide(d, 'same', big(0), hi(0), ctx()).ok);
  // two devices each with a full document: the union is cut to the cap, the newest stay
  let other = m.emptyDoc();
  for (let n = 0; n < m.MAX_LIVE; n++) other = apply(other, 'same', big(1000 + n), hi(1000 + n), { device: 'e', now: 5000 + n });
  const u1 = m.mergeDocs(d, other), u2 = m.mergeDocs(other, d);
  assert.deepEqual(u1, u2);
  assert.equal(m.entries(u1).length, m.MAX_LIVE);
  assert.ok(m.entries(u1).every((x) => x.at >= 5000), 'the newest ones are kept');
  // tombstones are capped on their own
  let t = u1;
  for (const x of m.entries(u1)) t = ok(m.remove(t, x.key, { device: 'e', now: 9000 })).doc;
  for (const x of m.entries(d)) t = m.mergeDocs(t, ok(m.remove(d, x.key, { device: 'e', now: 9001 })).doc);
  assert.ok(t.e.length <= m.MAX_LIVE + m.MAX_TOMBS);
  assert.ok(t.e.filter((e) => e.del).length <= m.MAX_TOMBS);
  assert.ok(JSON.stringify(u1).length < 120000, 'the document stays small');
});

test('garbage input: anything unreadable is dropped, nothing throws, long fields are cut', () => {
  for (const junk of [null, undefined, 5, 'x', [], {}, { e: 'x' }, { e: [null, 1, 'a', [], {}] }, JSON.parse('{"e":[{"k":"same","a":[],"b":[]}]}')]) {
    assert.deepEqual(m.sanitize(junk), m.emptyDoc());
    assert.deepEqual(m.mergeDocs(junk, junk), m.emptyDoc());
    assert.deepEqual(m.entries(junk), []);
    assert.equal(m.groups(junk).of.size, 0);
  }
  const bad = { e: [
    { k: 'merge', a: ['s', '1', 't'], b: ['k', '2', 't'] },                  // unknown kind
    { k: 'same', a: ['s', '1', 't'], b: ['s', '2', 't'] },                  // same server
    { k: 'same', a: ['s', '1', 't'], b: ['s', '1', 't'] },                  // itself
    { k: 'same', a: ['', '1', 't'], b: ['k', '2', 't'] },                   // no server
    { k: 'same', a: ['s', '', 't'], b: ['k', '2', 't'] },                   // no id
    { k: 'same', a: ['s', 1, 't'], b: ['k', '2'], rev: -4, dev: 7, at: 'x' }, // numbers and gaps are tolerated
    { k: 'diff', a: ['s', 'x'.repeat(500), 'T'.repeat(500)], b: ['k', '3', 't'], rev: 1.5, at: Infinity },
  ] };
  const out = m.sanitize(bad);
  assert.equal(out.e.length, 2);
  const x = m.entries(out);
  assert.ok(x.every((y) => y.a.i.length <= 200 && y.a.t.length <= 120 && y.b.t.length <= 120));
  assert.ok(x.every((y) => y.rev === 0 && Number.isFinite(y.at)));
  assert.deepEqual(m.sanitize(out), out, 'idempotent');
  assert.equal(m.decide(out, 'same', null, A, ctx()).reason, 'invalid');
  assert.equal(m.decide(out, 'maybe', A, B, ctx()).reason, 'invalid');
  assert.equal(m.decide(out, 'same', A, A, ctx()).reason, 'invalid');
});

test('identifiers with odd characters cannot collide: the key keeps server and id apart', () => {
  const p = R('komga', 'a|b'), q = R('komga', 'a'), r = R('suwayomi', 'b');
  assert.notEqual(m.pairKey(p, r), m.pairKey(q, R('suwayomi', 'b')));
  assert.equal(m.pairKey(A, B), m.pairKey(B, A));
  assert.notEqual(m.refKey(R('s', 'x:y')), m.refKey(R('s:x', 'y')));
});

test('a tombstone keeps no title', () => {
  const live = ok(m.decide(m.emptyDoc(), 'same', A, B, ctx())).doc;
  const gone = ok(m.remove(live, m.pairKey(A, B), ctx())).doc;
  assert.deepEqual(gone.e[0].a[2] + gone.e[0].b[2], '');
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('ALL PASS');
